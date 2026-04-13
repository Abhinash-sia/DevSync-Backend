const { PDFParse } = require('pdf-parse');
const fs = require('fs');

async function test() {
  const buffer = fs.readFileSync('package.json'); // Just some buffer to see if PDFParse accepts it or throws format error
  try {
    const parser = new PDFParse(buffer);
    const text = await parser.getText();
    console.log(text.text);
  } catch (e) {
    console.log("Error:", e.message);
  }
}
test();
