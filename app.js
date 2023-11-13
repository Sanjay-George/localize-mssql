const sql = require('mssql');
const fs = require('fs');
const path = require('path');
const csv = require('csv-parser');
const { populate } = require('dotenv');
require('dotenv').config();

// Read the SQL commands from the setup.sql file

const RETRIES = 10;
let pool = null;

// SQL Server connection string
const config = {
    user: 'SA',
    password: process.env['DB_PASSWORD'],
    server: 'db', // Use the name of the service. Localhost won't work with docker compose (since different IPs)
    database: 'master',
    authentication: {
        type: "default",
    },
    options: {
        encrypt: false // Use this if you're on Windows Azure
    }
};

async function createTables() {
    const sqlCommands = fs.readFileSync(path.join(__dirname, 'data', 'init.sql'), 'utf8').split(';');
    for (const command of sqlCommands) {
        // Skip if command is empty
        if (command.trim() === '') {
            continue;
        }
        try {
            await pool.request().query(command);
        } catch (err) {
            console.log(err);
            continue;
        }

    }
}

async function populateTables() {
    const directoryPath = path.join(__dirname, 'data');
    const subdirectories = fs.readdirSync(directoryPath);

    for (const subdirectory of subdirectories) {
        const subdirectoryPath = path.join(directoryPath, subdirectory);
        if (!fs.statSync(subdirectoryPath).isDirectory()) {
            continue;
        }

        const fileNames = fs.readdirSync(subdirectoryPath);
        for (const fileName of fileNames.sort()) {
            if (path.extname(fileName) !== '.csv') {
                continue;
            }

            const tableName = path.basename(fileName, '.csv')?.split('-')[1];
            const schemaName = subdirectory;

            // TODO: Check if foreign key exists on the table. If so, skip this table and do it later

            fs.createReadStream(path.join(subdirectoryPath, fileName))
                .pipe(csv())
                .on('data', async (row) => {
                    const columns = Object.keys(row).join(', ');
                    const values = Object.values(row).map(value => `'${value}'`).join(', ');
                    const query = `
                        SET IDENTITY_INSERT ${schemaName}.${tableName} ON;
                        INSERT INTO ${schemaName}.${tableName} (${columns}) VALUES (${values})
                        SET IDENTITY_INSERT ${schemaName}.${tableName} OFF;
                    `;

                    try {
                        await pool.request().query(query);
                    } catch (err) {
                        console.error(err);
                    }
                })
                .on('end', () => {
                    console.log(`CSV file ${subdirectoryPath}/${fileName} successfully processed`);
                });
        }
    }
}

async function connectToDB(retryLeft) {
    try {
        pool = await sql.connect(config);
        await createTables();
        await populateTables();
        console.log("Setup complete!");
    }
    catch (err) {
        console.error(err);
        if (retryLeft == 0) {
            process.exit(1);
        }
        console.log(`Retrying... ${retryLeft} retries left`);
        setTimeout(() => connectToDB(retryLeft - 1), 5000);
    }
}

console.log("Setting up database...");
connectToDB(RETRIES);
