// أنواع الخطوات اللي ممكن تتحط في الـ Flow — نفس ألوان وأسماء شاشة الأتمتة بتاعة المتجر.
// الملف ده مشترك بين البوت (السيرفر) وصفحة التحكم (المتصفح)، فما يستوردش أي حاجة من Node.

export const NODE_SPECS = {
  trigger: {
    label: 'المُشغّل',
    english: 'Trigger',
    description: 'بداية الـ Flow: إمتى يشتغل (كلمات معيّنة، أو أي رسالة البوت ما فهمهاش، أو صورة/ريكورد).',
    color: '#292722',
    defaults: { event: 'keywords', keywords: [], onlyIfAlone: false },
  },
  send_message: {
    label: 'إرسال رسالة',
    english: 'Send Message',
    description: 'يبعت رسالة للعميل. لو كتبت أكتر من صيغة، البوت يختار واحدة عشوائي.',
    color: '#0f766e',
    defaults: { texts: [''] },
  },
  ask_choice: {
    label: 'سؤال باختيارات',
    english: 'Choices',
    description: 'يسأل العميل ويدّيله اختيارات بأرقام (1، 2، 3). كل اختيار ليه مسار.',
    color: '#4f46e5',
    defaults: { text: '', options: ['أيوه', 'لا'], timeoutMinutes: 60 },
  },
  ask_question: {
    label: 'طرح سؤال',
    english: 'Ask Question',
    description: 'يسأل العميل سؤال ويستنى رده ويحفظه (مثلاً رقم الأوردر).',
    color: '#2563eb',
    defaults: { text: '', saveAs: 'answer', timeoutMinutes: 60 },
  },
  condition: {
    label: 'شرط',
    english: 'Condition',
    description: 'يختار مسار حسب قاعدة: الرسالة فيها كلمة، العميل جديد، عنده تصنيف، أو في مواعيد العمل.',
    color: '#7c3aed',
    defaults: { logic: 'and', rules: [{ type: 'message_contains', value: '' }] },
  },
  delay: {
    label: 'تأخير',
    english: 'Delay',
    description: 'يستنى مدة قبل ما يكمّل.',
    color: '#b45309',
    defaults: { amount: 5, unit: 'minutes' },
  },
  add_tag: {
    label: 'إضافة تصنيف',
    english: 'Add Tag',
    description: 'يضيف تصنيف للعميل (مثلاً: مهتم بالخواتم).',
    color: '#15803d',
    defaults: { tag: '' },
  },
  remove_tag: {
    label: 'إزالة تصنيف',
    english: 'Remove Tag',
    description: 'يشيل تصنيف من العميل.',
    color: '#b91c1c',
    defaults: { tag: '' },
  },
  handoff: {
    label: 'تحويل لموظف',
    english: 'Handoff',
    description: 'يبعت رسالة للعميل، والبوت يسكت في المحادثة دي لحد ما ترجّعه، ويبعتلك إشعار.',
    color: '#0369a1',
    defaults: { text: '', hours: 0 },
  },
};

export const NODE_ORDER = ['trigger', 'send_message', 'ask_choice', 'ask_question', 'condition', 'delay', 'add_tag', 'remove_tag', 'handoff'];

export const TRIGGER_EVENTS = {
  keywords: 'العميل كتب كلمات معيّنة',
  fallback: 'أي رسالة البوت ما فهمهاش',
  media: 'العميل بعت صورة أو ريكورد من غير كلام',
};

export const CONDITION_TYPES = {
  message_contains: { label: 'رسالة العميل فيها كلمة من', input: 'keywords', placeholder: 'شحن، توصيل' },
  has_tag: { label: 'العميل عنده تصنيف', input: 'text', placeholder: 'اسم التصنيف' },
  is_new_customer: { label: 'العميل أول مرة يكلمنا', input: 'none' },
  within_hours: { label: 'الوقت دلوقتي في مواعيد العمل', input: 'hours', placeholder: '11:00-23:00' },
  unmatched_at_least: { label: 'البوت ما فهمش العميل عدد مرات متتالية على الأقل', input: 'number', placeholder: '2' },
  answer_contains: { label: 'آخر إجابة للعميل فيها كلمة من', input: 'keywords', placeholder: 'أيوه، تمام' },
};

export const DELAY_UNITS = { seconds: 'ثانية', minutes: 'دقيقة', hours: 'ساعة' };

/** مخارج الخطوة (كل مخرج = سهم ممكن يطلع منه) */
export function nodeOutputs(type, data = {}) {
  switch (type) {
    case 'ask_choice':
      return [
        ...(data.options || []).map((o, i) => ({ id: `opt_${i}`, label: `${i + 1}. ${o || 'اختيار'}` })),
        { id: 'other', label: 'كتب حاجة تانية' },
        { id: 'timeout', label: 'ما ردش' },
      ];
    case 'ask_question':
      return [
        { id: 'answered', label: 'رد' },
        { id: 'timeout', label: 'ما ردش' },
      ];
    case 'condition':
      return [
        { id: 'true', label: 'صح' },
        { id: 'false', label: 'غلط' },
      ];
    case 'handoff':
      return [];
    default:
      return [{ id: 'next', label: 'بعده' }];
  }
}

/** ملخص قصير للخطوة يظهر جوه المربع */
export function nodeSummary(type, data = {}) {
  switch (type) {
    case 'trigger':
      if (data.event === 'keywords') return (data.keywords || []).length ? `رسالة فيها: ${data.keywords.slice(0, 6).join('، ')}${data.keywords.length > 6 ? '…' : ''}` : '';
      return TRIGGER_EVENTS[data.event] || '';
    case 'send_message':
      return (data.texts || []).find((t) => t && t.trim()) || '';
    case 'ask_choice':
      return data.text ? `${data.text}\n${(data.options || []).map((o, i) => `${i + 1}. ${o}`).join('  ')}` : '';
    case 'ask_question':
      return data.text || '';
    case 'condition':
      return (data.rules || [])
        .map((r) => `${CONDITION_TYPES[r.type]?.label || r.type}${r.value ? `: ${r.value}` : ''}`)
        .join(data.logic === 'or' ? ' أو ' : ' و ');
    case 'delay':
      return data.amount ? `يستنى ${data.amount} ${DELAY_UNITS[data.unit] || ''}` : '';
    case 'add_tag':
    case 'remove_tag':
      return data.tag ? `«${data.tag}»` : '';
    case 'handoff':
      return data.text || 'رسالة التحويل الافتراضية (من الإعدادات)';
    default:
      return '';
  }
}

export function newNodeData(type) {
  return JSON.parse(JSON.stringify(NODE_SPECS[type]?.defaults || {}));
}

/** "شحن، توصيل, delivery" → ["شحن","توصيل","delivery"] */
export function splitList(s) {
  return String(s || '')
    .split(/[\n,،]+/)
    .map((w) => w.trim())
    .filter(Boolean);
}
