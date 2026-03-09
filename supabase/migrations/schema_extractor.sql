-- ======================================================================
-- SUPABASE SCHEMA OVERVIEW SCRIPT
-- Copy and run this entire script in your Supabase SQL Editor.
-- It will return a clear list of all your tables, columns, and data types,
-- so I can see exactly how your database is set up right now.
-- ======================================================================

SELECT 
    t.table_name AS "Table Name",
    c.column_name AS "Column Name",
    c.data_type AS "Data Type",
    COALESCE(c.character_maximum_length::text, '') AS "Max Length",
    c.is_nullable AS "Is Nullable?",
    c.column_default AS "Default Value"
FROM 
    information_schema.tables t
JOIN 
    information_schema.columns c ON t.table_name = c.table_name
WHERE 
    t.table_schema = 'public' 
    AND t.table_type = 'BASE TABLE'
ORDER BY 
    t.table_name, 
    c.ordinal_position;
