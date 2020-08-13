/* --------------------
 * got-resume module
 * Tests
 * ------------------*/

'use strict';

// Modules
const chai = require('chai'),
	expect = chai.expect,
	pathJoin = require('path').join,
	fs = require('fs-extra-promise'),
	gotResume = require('../lib/');

// Constants
const URL_PREFIX =
	'https://raw.githubusercontent.com/overlookmotel/got-resume/master/test/files/';
const TEMP_DIR = pathJoin(__dirname, 'temp');

// Init
chai.config.includeStack = true;

// Tests

/* jshint expr: true */
/* global describe, it, beforeEach, afterEach */

describe('Tests', () => {
	describe('Streams', () => {
		it('empty file', (done) => {
			const stream = gotResume(`${URL_PREFIX}empty.txt`);

			let count = 0,
				err;
			stream.on('data', () => count++);
			stream.on('end', () => {
				if (err) return;
				if (count)
					return done(new Error('No data should have been received'));
				done();
			});
			stream.on('error', (_err) => {
				err = _err;
				done(err);
			});
		});

		it('short file', (done) => {
			const stream = gotResume(`${URL_PREFIX}short.txt`);

			let out = '',
				err;
			stream.on('data', (data) => {
				out += data.toString();
			});
			stream.on('end', () => {
				if (err) return;
				if (out != 'ABCDEFGHIJKLMNOPQRSTUVWXYZ')
					return done(new Error('Bad data received'));
				done();
			});
			stream.on('error', (_err) => {
				err = _err;
				done(err);
			});
		});
	});
});
