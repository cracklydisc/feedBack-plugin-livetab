'use strict';

// Pull one top-level function out of a source file by name, brace-matched, so
// it can run in an isolated vm sandbox without executing the whole module.
//
// Vendored from fee[dB]ack's own tests/js/test_utils.js, unchanged, so this
// repository's tests run with nothing but Node and no checkout of the app.

function extractFunction(src, signature) {
    const start = src.indexOf(signature);
    if (start === -1) throw new Error(`extractFunction: '${signature}' not found`);
    let scan = start + signature.length;
    if (src[scan] === '(') {
        let parenDepth = 1;
        scan++;
        while (scan < src.length && parenDepth > 0) {
            const ch = src[scan];
            if (ch === '(') parenDepth++;
            else if (ch === ')') parenDepth--;
            scan++;
        }
    }
    const openBrace = src.indexOf('{', scan);
    if (openBrace === -1) throw new Error(`extractFunction: no '{' after '${signature}'`);
    let depth = 1;
    let i = openBrace + 1;
    while (i < src.length && depth > 0) {
        const ch = src[i];
        if (ch === '{') depth++;
        else if (ch === '}') depth--;
        i++;
    }
    if (depth !== 0) throw new Error(`extractFunction: unbalanced braces after '${signature}'`);
    return src.slice(start, i);
}

module.exports = { extractFunction };
