/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS is required to preserve the legacy package API. */
'use strict';

const core = require('brace-expansion-safe-core');
const unsafeExpand = typeof core === 'function' ? core : core.expand;
if (typeof unsafeExpand !== 'function') {
  throw new TypeError('Patched core did not expose expand().');
}

const MAX_PATTERN_LENGTH = 4096;
const MAX_BRACE_GROUPS = 32;
const MAX_RANGE_WIDTH = 1000;
const MAX_EXPANSIONS = 10000;

function estimateChoices(body) {
  const range = body.match(/^(-?\d+)\.\.(-?\d+)(?:\.\.(-?\d+))?$/);
  if (range) {
    const start = Number(range[1]);
    const end = Number(range[2]);
    const step = range[3] ? Math.abs(Number(range[3])) : 1;
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || !Number.isSafeInteger(step) || step < 1) {
      throw new RangeError('Unsafe brace range.');
    }
    const width = Math.floor(Math.abs(end - start) / step) + 1;
    if (width > MAX_RANGE_WIDTH) throw new RangeError('Brace range exceeds safe width.');
    return width;
  }
  return body.split(',').length;
}

function assertBounded(pattern) {
  if (typeof pattern !== 'string') throw new TypeError('Brace pattern must be a string.');
  if (pattern.length > MAX_PATTERN_LENGTH) throw new RangeError('Brace pattern exceeds safe length.');

  const groups = [...pattern.matchAll(/\{([^{}]*)\}/g)];
  if (groups.length > MAX_BRACE_GROUPS) throw new RangeError('Brace pattern has too many groups.');

  let estimate = 1;
  for (const group of groups) {
    estimate *= Math.max(1, estimateChoices(group[1]));
    if (!Number.isSafeInteger(estimate) || estimate > MAX_EXPANSIONS) {
      throw new RangeError('Brace expansion exceeds safe output bound.');
    }
  }
}

function expand(pattern) {
  assertBounded(pattern);
  const output = unsafeExpand(pattern);
  if (!Array.isArray(output)) throw new TypeError('Brace expansion returned an invalid result.');
  if (output.length > MAX_EXPANSIONS) throw new RangeError('Brace expansion exceeded safe output bound.');
  return output;
}

module.exports = expand;
module.exports.expand = expand;
module.exports.limits = Object.freeze({
  maxPatternLength: MAX_PATTERN_LENGTH,
  maxBraceGroups: MAX_BRACE_GROUPS,
  maxRangeWidth: MAX_RANGE_WIDTH,
  maxExpansions: MAX_EXPANSIONS,
});
