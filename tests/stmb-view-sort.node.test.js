import assert from 'node:assert/strict';
import test from 'node:test';

import { createViewSort } from '../public/scripts/stmb-view-sort-policy.js';

test('prompt table sort cycles, switches columns, and restores manager order', () => {
    const rows = [
        { name: 'Item 10', count: 3 },
        { name: 'Item 2', count: 1 },
        { name: 'Item 2', count: 2 },
    ];
    const fields = { name: row => row.name, count: row => row.count };
    const sort = createViewSort();
    sort.cycle('name');
    assert.deepEqual(sort.order(rows, fields), [rows[1], rows[2], rows[0]]);
    sort.cycle('name');
    assert.deepEqual(sort.order(rows, fields), [rows[0], rows[1], rows[2]]);
    sort.cycle('name');
    assert.deepEqual(sort.order(rows, fields), rows);
    sort.cycle('count');
    assert.deepEqual(sort.order(rows, fields), [rows[1], rows[2], rows[0]]);
    sort.reset();
    assert.deepEqual(sort.order(rows, fields), rows);
    assert.deepEqual(rows.map(row => row.count), [3, 1, 2]);
});

test('prompt table sort handles numeric values, stable ties, and empty lists', () => {
    const rows = [{ n: 10 }, { n: 2 }, { n: 2 }, { n: 1 }];
    const sort = createViewSort();
    sort.cycle('n');
    assert.deepEqual(sort.order(rows, { n: row => row.n }), [rows[3], rows[1], rows[2], rows[0]]);
    assert.deepEqual(sort.order([], { n: row => row.n }), []);
});
