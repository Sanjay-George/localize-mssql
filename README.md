# localize-mssql
This repo contains a docker-based solution to containerize and run Microsoft SQL with automated creation of schemas and tables, and population of data from CSV files. This helps with creating a predefined copy of an application's database, which can help with local development, end-to-end testing, etc. This is not a tool per se, but rather a template or a solution using existing tools like docker.
 
# Quick Start 🚀
1. Install [Docker Engine](https://docs.docker.com/engine/install/)
2. Fork or clone this repo
3. Duplicate and rename `.env.example` file to `.env` and set all values.
4. Create and populate `data` folder. 
   - Create `data/__ddl__` folder and add all DDL statements as `.sql` files
   - [Read the section below](#populating-the-data-folder) to understand how to populate this folder.
6. (Optional): Rename `name` inside [docker-compose.yml](https://github.com/Sanjay-George/localize-mssql/blob/06dec3986962da9ca33f85e6967a88870b6c0b85/docker-compose.yml#L1) to your project/app name. Default is `localize-mssql`.
7. Install all dependencies by running `npm install`
8. To create a fresh copy of all tables and data, run `npm start`. This will initialize the MSSQL server and run all SQL scripts and insert statements.
9. Once the tables have been populated with the test data, commit the changes to create a new image `docker commit <container-id> <app-name>:<tag>`.

The created image (which runs MSSQL server with preconfigured test data) can now be used across your dev and testing environments! And this solution works easily with CI too! 

## Commands
| Command | Description |
| --- | --- |
| docker compose --profile init up -d | Initialize MS SQL server, create all tables and schemas, <br/> populate tables with data. (This will also keep the server running) |
| docker compose stop | Stop the server |
| docker compose start | Start the MS SQL server (if initiialization was already done) |
| docker commit \<container-id> \<app-name>:\<tag> | Commit the sql server to create an image with the populated data |

## Populating the data folder
- Add all DDL statements inside `data/__ddl__/`. Prefix with a number for ordering.
    - Example: `01-fileA.sql` will be executed before `02-fileB.sql`  
- For populating data, create a subdirectory with the schema name, and a csv file with table name.
    - Example: For a table `dbo.table1`, create a subdirectory `dbo` (inside the data folder) and a file `01-table1.csv`.
    - The numbering before table name ensures the order in which to execute the files. This helps with foreign key constraints.

# Issues ⚠️
### MSSQL image incompatibility with ARM devices
[MSSQL image from Microsoft](https://hub.docker.com/_/microsoft-mssql-server) does not support ARM64 architecture (Apple Silicon devices will be affected). Follow [this blog](https://devblogs.microsoft.com/azure-sql/development-with-sql-in-containers-on-macos/) for a workaround. The workaround is to use Rosetta (included in Docker engine) for emulating amd64 images.


# References 📃
- [Docker Commit](https://docs.docker.com/engine/reference/commandline/commit/)
- [SQL Server Docker Image](https://learn.microsoft.com/en-us/sql/linux/quickstart-install-connect-docker?view=sql-server-ver16)
