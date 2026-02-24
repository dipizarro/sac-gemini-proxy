const { parse } = require('csv-parse/sync');

const csvClean = `ID_CENTRO,MATERIAL1,SUMA_NETA
4010,MAT123,100.50
4020,MAT456,200.00`;

const csvDirty = `,Indicadores,SUMA_NETA
,,MATERIAL1,ID_CENTRO
,,MAT123,4010,100.50
,,MAT456,4020,200.00`;

function processLines(lines) {
    let materialLineIndex = -1;
    for (let i = 0; i < lines.length; i++) {
        if (lines[i].includes("MATERIAL1")) {
            materialLineIndex = i;
            break;
        }
    }

    if (materialLineIndex === -1) {
        throw new Error("No MATERIAL1 column found");
    }

    const h2Raw = lines[materialLineIndex];
    const h2 = parse(h2Raw, { delimiter: ',', columns: false })[0];
    let finalHeaders = [...h2];
    let isDoubleHeader = false;

    if (materialLineIndex > 0) {
        const lineAbove = lines[materialLineIndex - 1];
        if (lineAbove.includes("SUMA_NETA") || lineAbove.includes("Indicadores")) {
            isDoubleHeader = true;
            const h1 = parse(lineAbove, { delimiter: ',', columns: false })[0];

            for (let i = 0; i < h2.length; i++) {
                if ((!h2[i] || h2[i].trim() === "") && h1[i] && h1[i].trim() !== "") {
                    finalHeaders[i] = h1[i];
                }
            }
        }
    }

    let leadingEmpty = 0;
    for (let i = 0; i < finalHeaders.length; i++) {
        if (!finalHeaders[i] || finalHeaders[i].trim() === "") {
            leadingEmpty++;
        } else {
            break;
        }
    }

    finalHeaders = finalHeaders.slice(leadingEmpty).map(h => h.trim().replace(/ /g, "_").replace(/"/g, ""));

    const dataLines = lines.slice(materialLineIndex + 1).join('\n');
    let data;

    if (leadingEmpty > 0) {
        const rawRecords = parse(dataLines, {
            delimiter: ',',
            columns: false,
            skip_empty_lines: true
        });

        data = rawRecords.map(record => {
            const trimmedRecord = record.slice(leadingEmpty);
            const obj = {};
            finalHeaders.forEach((header, index) => {
                obj[header] = trimmedRecord[index];
            });
            return obj;
        });
    } else {
        data = parse(dataLines, {
            delimiter: ',',
            columns: finalHeaders,
            skip_empty_lines: true
        });
    }

    console.log(`[CSV] headerMode=${isDoubleHeader ? 'double' : 'single'}, leadingEmpty=${leadingEmpty}`);
    return data;
}

console.log("--- CLEAN CSV ---");
const cleanResult = processLines(csvClean.split('\n'));
console.log(cleanResult);
console.log("SUMA_NETA found:", cleanResult[0].hasOwnProperty("SUMA_NETA"));

console.log("\n--- DIRTY CSV ---");
const dirtyResult = processLines(csvDirty.split('\n'));
console.log(dirtyResult);
console.log("SUMA_NETA found:", dirtyResult[0].hasOwnProperty("SUMA_NETA"));
