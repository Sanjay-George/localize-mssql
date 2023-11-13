## Quick Start
1. Install [Docker Engine](https://docs.docker.com/engine/install/)
2. Clone and rename `.env.example` to `.env` and set all values.
3. Clone and rename `data_example` folder to `data`. [Read the section below](#populating-the-data-folder) to understand how to populate this folder
4. To create a fresh instance of all tables, run `docker compose --profile install up -d` to initialize the mssql server and run all SQL scripts and insert statements
5. To start just the database, run `docker compose up -d` to just start the already initialized mssql server.

### Populating the data folder
- Add all DDL (CREATE/ALTER) statements inside `data/init.sql`. 
- For populating data, create a subdirectory with the schema name, and a csv file with table name.
    - Example: For a table `dbo.table1`, create a subdirectory `dbo` (inside the data folder) and a file `01-table1.csv`.
    - The numbering before table name ensures the order in which to execute the files. This helps with foreign key constraints.

## Todo

- [ ] Better way to automatically import data from csv (looking at foreign keys and deciding order of execution)
- [ ] Should make it Idempotent? if so, how?   
