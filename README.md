# localize-mssql
This repo contains a docker-based solution to containerize and run MSSQL with automated creation of schemas and tables, and population of data from CSV files. This helps with creating a predefined copy of an application's database, which can help with local devleopment, end-to-end testing, etc. This is not a tool per se, but rather a template or a solution using existing tools like docker.
 
# Quick Start 🚀
1. Install [Docker Engine](https://docs.docker.com/engine/install/)
2. Clone and rename `.env.example` to `.env` and set all values.
3. Populate `data` folder. [Read the section below](#populating-the-data-folder) to understand how to populate this folder
4. (Optional): Rename `name` inside `docker-compose.yml` to rename the docker compose project name. Default is `localize-mssql`.
5. To create a fresh copy of all tables and data, run `docker compose --profile init up -d`. This will initialize the mssql server and run all SQL scripts and insert statements.
6. To simply start the already initialized database, run `docker compose start`. Alternatively, use Docker desktop to start the service (will be named `db-1`).
7. Once the tables have been populated with the test data, commit the changes to create a new image `docker commit <container-id> <app-name>:<tag>`.

The created image (which runs MSSQL server with preconfigured test data) can now be used across your dev and testing environments! And this solution works easily with CI too! 

### Commands
| Description | Command |
| --- | --- |
| Initialize MS SQL server, create all tables and schemas, <br/> populate tables with data. (This will also keep the server running)   | docker compose --profile init up -d |
| Stop the server | docker compose stop |
| Start the MS SQL server (if initiialization was already done) | docker compose start |

### Populating the data folder
- Add all DDL statements inside `data/init.sql`. 
- For populating data, create a subdirectory with the schema name, and a csv file with table name.
    - Example: For a table `dbo.table1`, create a subdirectory `dbo` (inside the data folder) and a file `01-table1.csv`.
    - The numbering before table name ensures the order in which to execute the files. This helps with foreign key constraints.

## Issues ⚠️
### MSSQL image incompatibility with ARM devices
[MSSQL image from Microsoft](https://hub.docker.com/_/microsoft-mssql-server) does not support ARM64 architecture (Apple Silicon devices will be affected). Follow [this blog](https://devblogs.microsoft.com/azure-sql/development-with-sql-in-containers-on-macos/) for a workaround. The workaround is to use Rosetta (included in Docker engine) for emulating amd64 images.
