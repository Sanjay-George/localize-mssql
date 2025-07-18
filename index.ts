import chalk from "chalk";

import sql from 'mssql';
import fs from 'fs';
import path from 'path';
import csv from 'csv-parser';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { ColumnSchema, getTableSchema, mapCSVValue } from "./utils";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config();

const RETRIES = 10;
const DELIMITER = 'GO';
const DATA_DIR = path.join(__dirname, 'data');
const LOGS_DIR = path.join(__dirname, 'logs');


// Connection config for the default master database
const masterDBConfig = {
    user: 'SA',
    server: 'localhost', // Name of the service in the docker-compose.yml
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
    server: 'localhost', // Name of the service in the docker-compose.yml
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
            console.error(chalk.red(`Invalid file name(s): ${invalidFileNames}. Expected format: [0-9]+-[A-Za-z0-9]+.sql (Eg: 01-schema1.sql)`));
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
            const fileContent = await fs.promises.readFile(filePath, 'utf8');

            // Split file into individual batches on lines with only GO (case-insensitive, ignore surrounding whitespace)
            const sqlCommands = fileContent
                .split(/^\s*GO\s*$/gim)
                .map(s => s.trim())
                .filter(Boolean); // Remove empty or whitespace-only

            for (const [idx, command] of sqlCommands.entries()) {
                // Ignore empty
                if (!command) continue;

                try {
                    await pool.request().query(command);
                } catch (err) {
                    console.error(chalk.red(`Error executing command in file ${fileName}, command #${idx + 1}:\n${command.substring(0, 150)}...`));
                    console.error(chalk.gray(err));
                    continue;
                }
            }
        }
    } catch (error) {
        console.error(`Error processing DDL files`);
        console.error(error);
    }
}

const processFile = async (
    pool,
    tableName: string,
    schemaName: string,
    csvPath: string): Promise<void> => {

    return new Promise((resolve, reject) => {
        console.log(chalk.blue(`Processing file ${csvPath}...`));

        const db = process.env['DB_NAME'];
        let rows: any[] = [];

        fs.createReadStream(csvPath)
            .pipe(csv())
            .on('data', (row) => {
                rows.push(row);
            })
            .on('end', async () => {
                if (!rows.length) {
                    console.log(`No data for ${schemaName}.${tableName}`);
                    resolve();
                    return;
                }

                // Prepare columns and fetch Column schema
                const columns = Object.keys(rows[0]);
                const columnsSchema: ColumnSchema[] = await getTableSchema(pool, schemaName, tableName);


                for (const row of rows) {
                    const values = columns.map((col, i) =>
                        mapCSVValue(row[col], columnsSchema[i].type, columnsSchema[i].nullable)
                    );
                    const paramPlaceholders = columns.map((_, i) => `@p${i}`).join(', ');

                    const query = `
                        BEGIN TRY
                            ALTER TABLE [${db}].[${schemaName}].[${tableName}] NOCHECK CONSTRAINT ALL;
                            SET IDENTITY_INSERT [${db}].[${schemaName}].[${tableName}] ON;
                        END TRY BEGIN CATCH END CATCH
                        INSERT INTO [${db}].[${schemaName}].[${tableName}]
                            (${columns.map(c => `[${c}]`).join(', ')})
                        VALUES (${paramPlaceholders});
                        BEGIN TRY
                        ALTER TABLE [${db}].[${schemaName}].[${tableName}] WITH CHECK CHECK CONSTRAINT ALL;
                        SET IDENTITY_INSERT [${db}].[${schemaName}].[${tableName}] OFF;
                        END TRY BEGIN CATCH END CATCH
                    `;

                    console.log(values);

                    try {
                        const req = pool.request();
                        columns.forEach((_, idx) =>
                            req.input(`p${idx}`, values[idx])
                        );
                        await req.query(query);
                    } catch (err) {
                        console.error(chalk.red(err));
                        console.info(`Errored query: ${query}`);
                    }
                }
                console.log(`CSV file ${csvPath} as [${db}].[${schemaName}].[${tableName}] loaded`);
                resolve();
            })
            .on('error', (err) => {
                console.error(`Error reading file ${csvPath}: ${err}`);
                reject(err);
            });
    });
}

async function populateTables(pool) {
    try {
        const subdirectories = fs.readdirSync(DATA_DIR);

        for (const schemaName of subdirectories) {
            // skip __ddl__ directory
            if (schemaName === '__ddl__') continue;

            const schemaDir = path.join(DATA_DIR, schemaName);
            if (!fs.statSync(schemaDir).isDirectory()) continue;

            const csvFiles = fs.readdirSync(schemaDir)
                .filter(f => path.extname(f).toLowerCase() === '.csv')
                .sort();

            console.log(`Processing schema: ${schemaName} with ${csvFiles.length} CSV files`);

            for (const fileName of csvFiles) {
                const tableName = path.basename(fileName, '.csv');
                const csvPath = path.join(schemaDir, fileName);
                await processFile(pool, tableName, schemaName, csvPath);
            }
        }
    } catch (error) {
        console.error(`Error populating tables`);
        console.error(error);
    }
}

async function connectToDB(retryLeft) {
    try {
        const masterPool = await sql.connect(masterDBConfig);
        await processDDLs(masterPool);
        console.log("DDL files processed successfully");
        await masterPool.close();


        console.log("Connecting to user database...");
        const pool = await sql.connect(customDBConfig);
        await populateTables(pool);
        await pool.close();

        console.log(chalk.green("Setup complete!"));
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



