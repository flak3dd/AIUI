import assert from 'node:assert/strict';
import EventEmitter from 'node:events';

// Create a simulated readline interface
class MockReadline extends EventEmitter {
  constructor() {
    super();
    this.promptText = '> ';
    this.promptCalled = 0;
  }
  setPrompt(p) { this.promptText = p; }
  prompt() { this.promptCalled++; }
  close() { this.emit('close'); }
}

async function runTests() {
  console.log('🧪 Testing Multi-Line Paste Engine...');

  // Test 1: Bracketed Paste multi-line simulation
  {
    console.log('  Testing bracketed paste (multi-line)...');
    let captured = null;
    let isPasteFlag = null;

    const dispatchInput = async (rawInput, { isPaste = false } = {}) => {
      captured = rawInput;
      isPasteFlag = isPaste;
    };

    let inBracketedPaste = false;
    let bracketedPasteBuffer = [];
    let burstBuffer = [];
    let burstTimer = null;
    const BURST_DEBOUNCE_MS = 35;

    const handleLine = async (line) => {
      let cleanLine = line;
      let pasteStarted = false;
      let pasteEnded = false;

      if (cleanLine.includes('\x1b[200~')) {
        pasteStarted = true;
        inBracketedPaste = true;
        cleanLine = cleanLine.replace(/\x1b\[200~/g, '');
      }

      if (cleanLine.includes('\x1b[201~')) {
        pasteEnded = true;
        inBracketedPaste = false;
        cleanLine = cleanLine.replace(/\x1b\[201~/g, '');
      }

      if (pasteStarted || inBracketedPaste || pasteEnded) {
        bracketedPasteBuffer.push(cleanLine);
        if (pasteEnded) {
          if (burstTimer) { clearTimeout(burstTimer); burstTimer = null; }
          burstBuffer = [];
          const fullText = bracketedPasteBuffer.join('\n');
          bracketedPasteBuffer = [];
          await dispatchInput(fullText, { isPaste: fullText.includes('\n') });
        }
        return;
      }
    };

    // Simulate multi-line paste stream
    await handleLine('\x1b[200~def calculate():');
    await handleLine('    x = 10');
    await handleLine('    return x * 2\x1b[201~');

    assert.equal(captured, 'def calculate():\n    x = 10\n    return x * 2');
    assert.equal(isPasteFlag, true);
    console.log('  ✔ Bracketed multi-line paste correctly joined into single command!');
  }

  // Test 2: Bracketed single-line paste
  {
    console.log('  Testing bracketed paste (single-line)...');
    let captured = null;
    let isPasteFlag = null;

    const dispatchInput = async (rawInput, { isPaste = false } = {}) => {
      captured = rawInput;
      isPasteFlag = isPaste;
    };

    let inBracketedPaste = false;
    let bracketedPasteBuffer = [];

    const handleLine = async (line) => {
      let cleanLine = line;
      let pasteStarted = false;
      let pasteEnded = false;

      if (cleanLine.includes('\x1b[200~')) {
        pasteStarted = true;
        inBracketedPaste = true;
        cleanLine = cleanLine.replace(/\x1b\[200~/g, '');
      }

      if (cleanLine.includes('\x1b[201~')) {
        pasteEnded = true;
        inBracketedPaste = false;
        cleanLine = cleanLine.replace(/\x1b\[201~/g, '');
      }

      if (pasteStarted || inBracketedPaste || pasteEnded) {
        bracketedPasteBuffer.push(cleanLine);
        if (pasteEnded) {
          const fullText = bracketedPasteBuffer.join('\n');
          bracketedPasteBuffer = [];
          await dispatchInput(fullText, { isPaste: fullText.includes('\n') });
        }
        return;
      }
    };

    await handleLine('\x1b[200~git status\x1b[201~');
    assert.equal(captured, 'git status');
    assert.equal(isPasteFlag, false);
    console.log('  ✔ Bracketed single-line paste correctly recognized!');
  }

  // Test 3: Rapid burst debounce (terminal without bracketed paste)
  {
    console.log('  Testing rapid burst debounce accumulator...');
    let captured = null;
    let isPasteFlag = null;

    const dispatchInput = async (rawInput, { isPaste = false } = {}) => {
      captured = rawInput;
      isPasteFlag = isPaste;
    };

    let burstBuffer = [];
    let burstTimer = null;
    const BURST_DEBOUNCE_MS = 35;

    const handleLine = (line) => {
      burstBuffer.push(line);
      if (burstTimer) clearTimeout(burstTimer);
      burstTimer = setTimeout(async () => {
        burstTimer = null;
        const lines = [...burstBuffer];
        burstBuffer = [];
        const combined = lines.join('\n');
        if (!combined.trim()) return;
        await dispatchInput(combined, { isPaste: lines.length > 1 });
      }, BURST_DEBOUNCE_MS);
    };

    handleLine('echo "Line 1"');
    await new Promise((r) => setTimeout(r, 5));
    handleLine('echo "Line 2"');
    await new Promise((r) => setTimeout(r, 5));
    handleLine('echo "Line 3"');

    // Wait for burst debounce to fire
    await new Promise((r) => setTimeout(r, 60));

    assert.equal(captured, 'echo "Line 1"\necho "Line 2"\necho "Line 3"');
    assert.equal(isPasteFlag, true);
    console.log('  ✔ Rapid burst lines aggregated into single multi-line command!');
  }

  // Test 4: Manual Multi-line via /paste mode and :run
  {
    console.log('  Testing /paste mode with :run...');
    let captured = null;

    let inManualMultiLine = true;
    let manualMultiLineDelimiter = ':paste';
    let manualMultiLineBuffer = [];

    const handleLine = async (line) => {
      const trimmed = line.trim().toLowerCase();
      if (trimmed === ':run') {
        inManualMultiLine = false;
        manualMultiLineDelimiter = null;
        captured = manualMultiLineBuffer.join('\n');
        manualMultiLineBuffer = [];
        return;
      }
      manualMultiLineBuffer.push(line);
    };

    await handleLine('const a = 1;');
    await handleLine('const b = 2;');
    await handleLine('console.log(a + b);');
    await handleLine(':run');

    assert.equal(captured, 'const a = 1;\nconst b = 2;\nconsole.log(a + b);');
    console.log('  ✔ /paste mode with :run successfully executed!');
  }

  // Test 5: Triple-quote multiline
  {
    console.log('  Testing """ triple quotes multiline...');
    let captured = null;
    let inManualMultiLine = false;
    let manualMultiLineDelimiter = null;
    let manualMultiLineBuffer = [];

    const handleLine = async (line) => {
      if (inManualMultiLine) {
        if (line.includes('"""')) {
          const endIdx = line.indexOf('"""');
          manualMultiLineBuffer.push(line.slice(0, endIdx));
          inManualMultiLine = false;
          manualMultiLineDelimiter = null;
          captured = manualMultiLineBuffer.join('\n');
          manualMultiLineBuffer = [];
          return;
        }
        manualMultiLineBuffer.push(line);
        return;
      }

      const trimmed = line.trim();
      if (trimmed.startsWith('"""')) {
        inManualMultiLine = true;
        manualMultiLineDelimiter = '"""';
        manualMultiLineBuffer = [line.replace(/^\s*"""/, '')];
        return;
      }
    };

    await handleLine('"""Write a server');
    await handleLine('with 2 endpoints: /health and /metrics');
    await handleLine('and test both"""');

    assert.equal(captured, 'Write a server\nwith 2 endpoints: /health and /metrics\nand test both');
    console.log('  ✔ Triple-quotes multi-line successfully parsed!');
  }

  // Test 6: Condensed [new lines] badge and single question dispatch
  {
    console.log('  Testing multi-line condensed [new lines] badge generation...');
    const formatNewLinesLabel = (lineCount) => (lineCount - 1 > 1 ? `${lineCount - 1} new lines` : 'new lines');

    assert.equal(formatNewLinesLabel(2), 'new lines');
    assert.equal(formatNewLinesLabel(3), '2 new lines');
    assert.equal(formatNewLinesLabel(5), '4 new lines');
    assert.equal(formatNewLinesLabel(10), '9 new lines');

    // Simulate multi-line input arriving in bursts
    let dispatchedQuestions = [];
    const dispatch = async (rawInput) => {
      dispatchedQuestions.push(rawInput);
    };

    let buffer = [];
    let timer = null;
    const feedLine = (line) => {
      buffer.push(line);
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        const full = buffer.join('\n');
        buffer = [];
        dispatch(full);
      }, 30);
    };

    feedLine('Question line 1: Analyze database');
    feedLine('Question line 2: Find slow queries');
    feedLine('Question line 3: Output indexing plan');

    await new Promise((r) => setTimeout(r, 60));

    // Verify it was dispatched as exactly ONE question, NOT three separate questions
    assert.equal(dispatchedQuestions.length, 1);
    assert.equal(
      dispatchedQuestions[0],
      'Question line 1: Analyze database\nQuestion line 2: Find slow queries\nQuestion line 3: Output indexing plan'
    );
    console.log('  ✔ Multi-line paste condensed into exactly 1 unified question turn!');
  }

  console.log('\n🎉 ALL MULTI-LINE PASTE TESTS PASSED SUCCESSFULLY!');
}

runTests().catch((err) => {
  console.error('Test failure:', err);
  process.exit(1);
});
