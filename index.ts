const sql = require('mssql');
const fs = require('fs');
const path = require('path');
const csv = require('csv-parser');
require('dotenv').config();

const RETRIES = 10;

// Connection config for the default master database
const masterDBConfig = {
    user: 'SA',
    server: 'db', // Name of the service in the docker-compose.yml
    port: 1433,
    database: 'master',
    password: process.env['DB_PASSWORD'],
    authentication: {
        type: "default",
    },
    options: {
        encrypt: false,
        // trustServerCertificate: true,
    }
};

// Connection config for the custom database created
const customDBConfig = {
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
}

/**
 * Process .sql files in data/__ddl__ directory. Combine multiple files based on the order of the file names.
 */
async function processDDLs(pool): Promise<boolean> {
    try {
        const directoryPath = path.join(__dirname, 'data', '__ddl__');
        const fileNames = fs.readdirSync(directoryPath);

        // Validate file names
        const regex = /^[0-9]+-[A-Za-z0-9]+.sql$/;
        const invalidFileNames = fileNames.filter(fileName => !regex.test(fileName));
        if (invalidFileNames.length > 0) {
            console.error(`Invalid file name(s): ${invalidFileNames}. Expected format: [0-9]+-[A-Za-z0-9]+.sql (Eg: 01-schema1.sql)`);
            return false;
        }

        // Sort file names based on the number in the file name
        fileNames.sort((a, b) => {
            const aNum = parseInt(a.split('-')[0]);
            const bNum = parseInt(b.split('-')[0]);
            return aNum - bNum;
        });

        // execute sql commands in the files
        for (const fileName of fileNames) {
            const filePath = path.join(directoryPath, fileName);
            const sqlCommands = fs.readFileSync(filePath, 'utf8').split(';');
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
    } catch (error) {
        console.error(error);
    }
}

function isNumber(numberString) {
    return !isNaN(numberString);
}

function isNull(value) {
    return value === 'NULL';
}

const mapCSVValue = (value) => {
    if (value === '') return `''`;
    if (isNull(value)) return value;
    if (isNumber(value)) return value;
    return `'${value.replace(/'/g, "''")}'`;
}

const processFile = async (pool, fileName, subdirectoryPath, subdirectory): Promise<void> => {
    return new Promise((resolve, reject) => {
        const tableName = path.basename(fileName, '.csv')?.split('-')[1];
        if (!tableName) {
            console.error(`Invalid file name: ${fileName}. Expected format: [0-9]+-[A-Za-z0-9]+.csv (Eg: 1-table1.csv)`)
            resolve();
            return;
        }

        console.log(`Processing file ${subdirectoryPath}/${fileName}...`);
        const schemaName = subdirectory;
        const db = process.env['DB_NAME'];
        fs.createReadStream(path.join(subdirectoryPath, fileName))
            .pipe(csv())
            .on('data', async (row) => {
                const columns = Object.keys(row).join(', ');
                const values = Object.values(row).map(mapCSVValue).join(', ');
                const query = `
                    BEGIN TRY
                        SET IDENTITY_INSERT ${db}.${schemaName}.${tableName} ON;
                    END TRY
                    BEGIN CATCH
                    END CATCH

                    INSERT INTO ${db}.${schemaName}.${tableName} (${columns}) VALUES (${values});

                    BEGIN TRY
                        SET IDENTITY_INSERT ${db}.${schemaName}.${tableName} OFF;
                    END TRY
                    BEGIN CATCH
                    END CATCH
                `;
                try {
                    await pool.request().query(query);
                    if (process.env['SHOULD_GENERATE_SQL'] === 'true') {
                        const fileNameWithoutExtension = path.basename(fileName, path.extname(fileName));
                        fs.appendFileSync(path.join(subdirectoryPath, `${fileNameWithoutExtension}.sql`), query);
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

async function populateTables(pool) {
    try {
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
                await processFile(pool, fileName, subdirectoryPath, subdirectory);
            }
        }
    } catch (error) {
        console.error(error);
    }
}

async function connectToDB(retryLeft) {
    try {

        const masterPool = await sql.connect(masterDBConfig);
        await processDDLs(masterPool);

        const pool = await sql.connect(customDBConfig);
        await populateTables(pool);
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
