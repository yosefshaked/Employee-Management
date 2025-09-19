#!/usr/bin/env node
import process from 'node:process';
import { createClient } from '@supabase/supabase-js';

const REQUIRED_COLUMNS = [
  { table: 'WorkSessions', column: 'payable', types: ['boolean'] },
  { table: 'WorkSessions', column: 'entry_type', types: ['text', 'character varying'] },
  { table: 'LeaveBalances', column: 'balance', types: ['numeric', 'double precision', 'real', 'integer'] },
  { table: 'LeaveBalances', column: 'leave_type', types: ['text', 'character varying'] },
  { table: 'LeaveBalances', column: 'effective_date', types: ['date', 'timestamp with time zone', 'timestamp without time zone'] },
];

const supabaseUrl =
  process.env.APP_SUPABASE_URL ||
  process.env.SUPABASE_URL ||
  '';
const supabaseKey =
  process.env.APP_SUPABASE_SERVICE_ROLE ||
  process.env.APP_SUPABASE_ANON_KEY ||
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_KEY ||
  '';

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing Supabase credentials. Set APP_SUPABASE_URL and APP_SUPABASE_SERVICE_ROLE (or anon key) to run the schema check.');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function loadColumns() {
  const targetTables = [...new Set(REQUIRED_COLUMNS.map(item => item.table))];
  const { data, error } = await supabase
    .from('information_schema.columns')
    .select('table_name,column_name,data_type')
    .in('table_name', targetTables)
    .eq('table_schema', 'public');

  if (error) {
    console.error('Failed to inspect schema through Supabase:', error.message || error);
    process.exit(1);
  }

  return data || [];
}

function analyze(columns) {
  const byTable = new Map();
  for (const column of columns) {
    if (!byTable.has(column.table_name)) {
      byTable.set(column.table_name, new Map());
    }
    byTable.get(column.table_name).set(column.column_name, column.data_type);
  }

  const missing = [];
  const wrongType = [];

  for (const requirement of REQUIRED_COLUMNS) {
    const tableColumns = byTable.get(requirement.table) || new Map();
    const foundType = tableColumns.get(requirement.column);
    if (!foundType) {
      missing.push(`${requirement.table}.${requirement.column}`);
      continue;
    }
    if (!requirement.types.includes(foundType)) {
      wrongType.push({
        column: `${requirement.table}.${requirement.column}`,
        expected: requirement.types.join(', '),
        actual: foundType,
      });
    }
  }

  return { missing, wrongType };
}

function printChecklist(items) {
  if (!items.length) return;
  console.log('Add the following items to the PR checklist:');
  for (const item of items) {
    console.log(`- PM must add column ${item} before merge.`);
  }
}

function printTypeWarnings(items) {
  if (!items.length) return;
  console.log('\nColumn type mismatches detected:');
  for (const item of items) {
    console.log(`- ${item.column} has type "${item.actual}" (expected: ${item.expected}).`);
  }
}

async function main() {
  const columns = await loadColumns();
  const { missing, wrongType } = analyze(columns);

  if (!missing.length && !wrongType.length) {
    console.log('All required columns are present with expected types.');
    return;
  }

  if (missing.length) {
    printChecklist(missing);
  }
  if (wrongType.length) {
    printTypeWarnings(wrongType);
  }

  process.exit(2);
}

main().catch(error => {
  console.error('Unexpected error while verifying schema:', error);
  process.exit(1);
});
