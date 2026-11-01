import {test} from 'node:test';
import assert from 'node:assert/strict';
import {pageRange} from '../../src/library/pagination.ts';

test('all 1000 results are reachable once in stable order without changing selection', () => {
 const selection = Array.from({length: 1000}, (_, id) => ({id}));
 const seen = [];
 for(let page = 0; page < 20; page++) {
  const {start, end} = pageRange(selection.length, page);
  const rows = selection.slice(start, end);
  assert.equal(rows.length, 50);
  seen.push(...rows);
 }
 assert.deepEqual(seen, selection);
 assert.equal(selection.length, 1000);
});

test('partial last page, shrinking selection and empty selection clamp correctly', () => {
 assert.deepEqual(pageRange(91, 9), {page: 1, pages: 2, start: 50, end: 91, total: 91});
 assert.deepEqual(pageRange(0, 19), {page: 0, pages: 1, start: 0, end: 0, total: 0});
 assert.equal(pageRange(50, 1).page, 0);
 assert.equal(pageRange(51, -1).start, 0);
});
