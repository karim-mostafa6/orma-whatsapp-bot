// جرّب ردود البوت من التيرمنال من غير واتساب:  npm run try
// اكتب أي رسالة كأنك عميل، وشوف البوت هيرد بإيه. (Ctrl+C للخروج)
import readline from 'node:readline';
import { loadConfig } from '../src/config.js';
import { loadFaqFile, unfilledVariables } from '../src/faq.js';
import { createKeywordResponder } from '../src/responders/keyword.js';
import { createLlmResponder, createHybridResponder } from '../src/responders/llm.js';
import { render } from '../src/faq.js';

const config = loadConfig();
const keyword = createKeywordResponder();
const responder = config.responder === 'hybrid' ? createHybridResponder(keyword, createLlmResponder(config.llm), console) : keyword;

const missing = unfilledVariables(loadFaqFile(config.faqFile));
if (missing.length) console.log(`⚠️  معلومات ناقصة في faq.json: ${missing.join(', ')}\n`);
console.log('اكتب رسالة كأنك عميل (Ctrl+C للخروج). الملف بيتقري من جديد مع كل رسالة، فعدّل وجرّب على طول.\n');

const rl = readline.createInterface({ input: process.stdin, output: process.stdout, prompt: 'العميل> ' });
rl.prompt();
rl.on('line', async (line) => {
  if (line.trim()) {
    try {
      const faq = loadFaqFile(config.faqFile);
      const r = await responder(line, faq);
      if (r.type === 'answer') {
        console.log(`\n[${r.intents.join(' + ')}${r.handoff ? ' → وبعدين تحويل لموظف' : ''}]\n${r.text}\n`);
      } else if (r.type === 'handoff') {
        console.log(`\n[تحويل لموظف]\n${render(faq.system.handoff, faq.variables)}\n`);
      } else {
        console.log(`\n[مش فاهم — أول مرة بيرد بالرسالة دي، وتاني مرة بيحوّل لموظف]\n${render(faq.system.fallback, faq.variables)}\n`);
      }
    } catch (err) {
      console.log(`\n❌ ${err.message}\n`);
    }
  }
  rl.prompt();
});
