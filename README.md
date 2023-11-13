# Quick Start
1. Install [Docker Engine](https://docs.docker.com/engine/install/)
2. Clone and rename `.env.example` to `.env` and set all values.
3. Populate `data` folder. [Read the section below](#populating-the-data-folder) to understand how to populate this folder
4. To create a fresh copy of all tables and data, run `docker compose --profile init up -d` to initialize the mssql server and run all SQL scripts and insert statements.
5. To only start the database, run `docker compose start` to just start the already initialized mssql server.

### Populating the data folder
- Add all DDL (CREATE/ALTER) statements inside `data/init.sql`. 
- For populating data, create a subdirectory with the schema name, and a csv file with table name.
    - Example: For a table `dbo.table1`, create a subdirectory `dbo` (inside the data folder) and a file `01-table1.csv`.
    - The numbering before table name ensures the order in which to execute the files. This helps with foreign key constraints.

## Issues
### MSSQL image incompatibility with ARM devices
[MSSQL image from Microsoft](https://hub.docker.com/_/microsoft-mssql-server) does not support ARM64 architecture (Apple Silicon devices will be affected). Follow [this blog](https://devblogs.microsoft.com/azure-sql/development-with-sql-in-containers-on-macos/) for a workaround. The workaround is to use Rosetta (included in Docker engine) for emulating amd64 images.


## Todo

- [ ] Better way to automatically import data from csv (looking at foreign keys and deciding order of execution)
- [ ] Should make query execution idempotent? if so, how?   
