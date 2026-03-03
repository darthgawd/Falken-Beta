const fs = require('fs');
const path = require('path');

const lcovPath = path.resolve(__dirname, '../contracts/lcov.info');
if (!fs.existsSync(lcovPath)) {
  console.error('lcov.info not found. Run "pnpm contracts:coverage" first.');
  process.exit(1);
}

const content = fs.readFileSync(lcovPath, 'utf8');
const sections = content.split('end_of_record');

let totalHits = 0;
let totalLines = 0;
let fileStats = [];

sections.forEach(section => {
  const sfMatch = section.match(/^SF:(.+)/m);
  if (!sfMatch) return;
  
  const filePath = sfMatch[1];
  // ONLY count files in src/ (handle relative or absolute paths)
  if (!filePath.includes('/src/') && !filePath.startsWith('src/')) return;

  const lhMatch = section.match(/^LH:(\d+)/m);
  const lfMatch = section.match(/^LF:(\d+)/m);
  
  if (lhMatch && lfMatch) {
    const hits = parseInt(lhMatch[1], 10);
    const lines = parseInt(lfMatch[1], 10);
    totalHits += hits;
    totalLines += lines;
    
    const displayPath = filePath.includes('src/') ? filePath.split('src/')[1] : filePath;
    fileStats.push({
      file: displayPath,
      coverage: ((hits / lines) * 100).toFixed(2) + '%'
    });
  }
});

console.log('-----------------------------------------');
console.log('📊 FALKEN CORE LOGIC COVERAGE (SRC ONLY)');
console.log('-----------------------------------------');
fileStats.forEach(s => console.log(`${s.file.padEnd(30)} | ${s.coverage}`));
console.log('-----------------------------------------');
const totalPercent = ((totalHits / totalLines) * 100).toFixed(2);
console.log(`TOTAL CORE COVERAGE: ${totalPercent}%`);
console.log('-----------------------------------------');
