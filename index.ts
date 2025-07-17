import chalk from "chalk";

import sql from 'mssql';
import fs from 'fs';
import path from 'path';
import csv from 'csv-parser';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';

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

function isNumber(numberString) {
    return !isNaN(numberString);
}

function isNull(value) {
    return value === 'NULL';
}
function isString(value) {
    return typeof value === 'string' || value instanceof String;
}

const mapCSVValue = (value) => {
    if (value === '') return `''`;
    if (isNull(value)) return null;
    if (isNumber(value)) return Number(value);
    // return `'${value.replace(/'/g, "''")}'`;
    // if (isString(value)) return value.trim().replace(/^"|"$/g, '') // Remove surrounding quotes if any
    return value;
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
                // Prepare columns
                const columns = Object.keys(rows[0]);

                for (const row of rows) {
                    const values = columns.map(col => mapCSVValue(row[col]));
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

                        // Log the final query with parameters replaced

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
                .filter(f => path.extname(f).toLowerCase() === '.csv');

            console.log(`Processing schema: ${schemaName} with ${csvFiles.length} CSV files`);

            // Get just the table name from each CSV file
            const tableNames = csvFiles.map(f => path.basename(f, '.csv'));

            // Figure out correct FK insert order
            const tableOrder = await getTableOrder(pool, schemaName, tableNames);
            console.log(`For schema ${schemaName}, insert order: ${tableOrder.join(', ')}`);

            // Map tableName to CSV file name (case-insensitive, normalize)
            const fileForTable = Object.fromEntries(
                tableNames.map(tn => [tn.toLowerCase(), csvFiles.find(f => f.toLowerCase().endsWith(`${tn.toLowerCase()}.csv`))])
            );

            // Process each table in order
            for (const tableName of tableOrder) {
                const fileName = fileForTable[tableName.toLowerCase()];
                if (!fileName) {
                    console.warn(`Missing CSV file for ${schemaName}.${tableName}, skipping.`);
                    continue;
                }
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
        console.log("Connecting to custom database...");

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



/**
 * Retrieves the order of tables in a schema based on foreign key dependencies.
 * @param pool 
 * @param schemaName 
 * @param tableNames 
 * @returns 
 */
async function getTableOrder(pool, schemaName: string, tableNames: string[]): Promise<string[]> {
    // Only pull FKs for those tables for which you have CSVs (for simplicity)
    const quotedTableList = tableNames.map(t => `'${t}'`).join(",");
    const result = await pool.request().query(`
        SELECT 
            child = t1.name, 
            parent = t2.name
        FROM sys.foreign_keys fk
        JOIN sys.tables t1 ON fk.parent_object_id = t1.object_id
        JOIN sys.schemas s1 ON t1.schema_id = s1.schema_id
        JOIN sys.tables t2 ON fk.referenced_object_id = t2.object_id
        JOIN sys.schemas s2 ON t2.schema_id = s2.schema_id
        WHERE s1.name = '${schemaName}'
            AND s2.name = '${schemaName}'
            AND t1.name IN (${quotedTableList})
            AND t2.name IN (${quotedTableList})
    `);

    // Build dependency graph
    const deps: { [table: string]: Set<string> } = {};
    tableNames.forEach(t => deps[t] = new Set());
    result.recordset.forEach((row: { child: string, parent: string }) => {
        deps[row.child].add(row.parent);
    });

    // Store the deps into a file
    fs.mkdirSync(LOGS_DIR, { recursive: true });
    const depsFilePath = path.join(LOGS_DIR, `${schemaName}-dependency-map.json`);
    fs.writeFileSync(depsFilePath, JSON.stringify(deps, null, 2));

    // Kahn's algorithm for topo sort:
    const order: string[] = [];
    while (Object.keys(deps).length > 0) {
        const ready = Object.entries(deps)
            .filter(([_, parents]) => parents.size === 0)
            .map(([table]) => table);
        if (ready.length === 0) throw new Error('Cyclic dependency detected!');
        order.push(...ready);
        for (const t of ready) delete deps[t];
        for (const set of Object.values(deps)) {
            ready.forEach(t => set.delete(t));
        }
    }
    return order;
}

