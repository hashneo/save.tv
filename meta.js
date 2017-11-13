var fs = require('fs');

var meta = JSON.parse(fs.readFileSync( process.argv[2], 'utf8'));

console.log(meta[process.argv[3]]);