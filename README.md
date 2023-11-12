## Quick Start
1. Install Docker Engine 
2. Clone and rename `.env.example` to `.env` and set all values. 
2. To create a fresh instance of all tables, run `docker compose --profile install up -d` to initialize the mssql server and run all SQL scripts and insert statements
3. To start just the database, run `docker compose up -d` to just start the already initialized mssql server. 

## Todo

- [ ] Better way to automatically import data from csv (looking at foreign keys and deciding order of execution)
- [ ] Should make it Idempotent? if so, how?   