/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS is required to preserve the legacy package API. */
'use strict';
const secureCore = require('brace-expansion-safe-core');
const expand = typeof secureCore === 'function' ? secureCore : secureCore.expand;
if (typeof expand !== 'function') throw new TypeError('Patched core did not expose expand().');
module.exports = expand;
module.exports.expand = expand;
