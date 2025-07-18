export type ColumnSchema = {
    name: string;
    type: string;
    nullable: boolean;
};

export async function getTableSchema(pool, schemaName, tableName): Promise<ColumnSchema[]> {
    const result = await pool.request()
        .input('schema', schemaName)
        .input('table', tableName)
        .query(`
        SELECT COLUMN_NAME as name, DATA_TYPE as type,
               CASE WHEN IS_NULLABLE = 'YES' THEN 1 ELSE 0 END as nullable
        FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = @schema AND TABLE_NAME = @table
        ORDER BY ORDINAL_POSITION
      `);
    return result.recordset.map(r => ({
        name: r.name,
        type: r.type,
        nullable: !!r.nullable
    }));
}



export function mapCSVValue(value: string, columnType: string, nullable: boolean): any {
    if (value === '' || value === undefined) {
        // If the column allows nulls, return null
        if (nullable) return null;

        // Return default value based on type
        switch (columnType.toLowerCase()) {
            case 'int':
            case 'bigint':
            case 'smallint':
            case 'tinyint':
            case 'float':
            case 'real':
            case 'decimal':
            case 'numeric':
                return 0;
            case 'bit':
                return false;
            case 'date':
            case 'datetime':
            case 'smalldatetime':
            case 'datetime2':
            case 'time':
                return null; // See if NULL is accepted, or use some default date
            default: // treat as text/varchar
                return '';
        }
    }
    if (value === 'NULL') return null;

    switch (columnType.toLowerCase()) {
        case 'int':
        case 'bigint':
        case 'smallint':
        case 'tinyint':
        case 'float':
        case 'real':
        case 'decimal':
        case 'numeric':
            return Number(value);
        case 'bit':
            return value === '1' || value.toLowerCase() === 'true';
        default:
            return value;
    }
}