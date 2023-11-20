const sql = require('mssql');
const fs = require('fs');
const path = require('path');
const csv = require('csv-parser');
require('dotenv').config();

const RETRIES = 10;
let pool = null;

// SQL Server connection string
const config = {
    user: 'SA',
    server: 'db', // Name of the service in the docker-compose.yml
    database: process.env['DB_NAME'],
    password: process.env['DB_PASSWORD'],
    authentication: {
        type: "default",
    },
    options: {
        encrypt: false
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

function isDate(dateString) {
    const date = new Date(dateString);
    return !isNaN(date);
}

function isNumber(numberString) {
    return !isNaN(numberString);
}

function isNull(value) {
    return value === 'NULL';
}

const mapCSVValue = (value) => {
    if (value === '') return `''`;
    if(isNull(value)) return value;
    if(isNumber(value)) return value; 
    return `'${value.replace(/'/g, "''") }'`;
}

const processFile = async (fileName, subdirectoryPath, subdirectory) => {
    return new Promise((resolve, reject) => {
        const tableName = path.basename(fileName, '.csv')?.split('-')[1];
        if (!tableName) {
            console.error(`Invalid file name: ${fileName}. Expected format: [0-9]+-[A-Za-z0-9]+.csv (Eg: 1-table1.csv)`)
            resolve();
            return;
        }

        console.log(`Processing file ${subdirectoryPath}/${fileName}...`);
        const schemaName = subdirectory;
        fs.createReadStream(path.join(subdirectoryPath, fileName))
            .pipe(csv())
            .on('data', async (row) => {
                const columns = Object.keys(row).join(', ');
                const values = Object.values(row).map(mapCSVValue).join(', ');
                const query = `
                    SET IDENTITY_INSERT ${schemaName}.${tableName} ON;
                    INSERT INTO ${schemaName}.${tableName} (${columns}) VALUES (${values});
                    SET IDENTITY_INSERT ${schemaName}.${tableName} OFF;
                `;
                try {
                    await pool.request().query(query);
                    if (process.env['SHOULD_GENERATE_SQL'] === 'true') {
                        const fileNameWithoutExtension = path.basename(fileName, path.extname(fileName));
                        fs.appendFileSync(path.join(subdirectoryPath,`${fileNameWithoutExtension}.sql`), query);
                    }
                } catch (err) {
                    console.error(err);
                    console.info(`Errored query: ${query}`);
                }
            })
            .on('end', () => {
                console.log(`CSV file ${subdirectoryPath}/${fileName} successfully processed`);
                resolve();
            })
            .on('error', (err) => {
                console.error(`Error processing file ${subdirectoryPath}/${fileName}: ${err}`);
                reject(err);
            });
    });
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
            await processFile(fileName, subdirectoryPath, subdirectory);
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
