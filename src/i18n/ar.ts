import type { Dict } from './en';

const ar: Dict = {
  brand: { name: 'ResQAir', college: 'الكلية العسكرية التقنية' },
  common: {
    close: 'إغلاق', demo: 'محاكاة', error: 'حدث خطأ', errorBody: 'حاول مرة أخرى.', justNow: 'الآن',
    language: 'اللغة', loading: 'جارٍ التحميل…', optional: 'اختياري', retry: 'إعادة المحاولة',
  },
  nav: { report: 'بلاغ حريق', pilot: 'الطيار' },
  report: {
    title: 'بلاغ حريق',
    lead: 'اضغط على مكان الحريق في خريطة الكلية.',
    step1: 'الموقع', step2: 'حجم الحريق', step3: 'نوع الحريق', step4: 'تفاصيل أخرى',
    tapMap: 'اضغط على الخريطة لتحديد المكان', located: 'تم تحديد الموقع — اسحب الدبوس للتعديل', outside: 'اختر نقطة داخل الكلية.',
    detailsPh: 'مثال: دخان طالع من سقف الورشة',
    send: 'إرسال البلاغ', sending: 'جارٍ الإرسال…', missing: 'حدد الموقع والحجم والنوع للإرسال.',
    sent: 'تم إرسال البلاغ', sentLead: 'وصل بلاغك لطيار الدرون ويقدر يرسل الدرونات الحين.', ref: 'رقم البلاغ', another: 'بلاغ جديد',
    emergency: 'فيه أشخاص في خطر؟ اتصل بـ 9999 فوراً.',
    sizes: { small: 'صغير', medium: 'متوسط', large: 'كبير' } as Record<string, string>,
    sizeHint: { small: 'أصغر من سيارة', medium: 'بحجم غرفة', large: 'ينتشر' } as Record<string, string>,
    types: { vegetation: 'أعشاب / أشجار', building: 'مبنى', vehicle: 'مركبة / وقود', electrical: 'كهربائي', other: 'أخرى' } as Record<string, string>,
  },
  pilot: {
    title: 'لوحة الطيار', signInLead: 'لطياري الدرون فقط.', username: 'اسم المستخدم', password: 'كلمة المرور', signIn: 'دخول', signOut: 'خروج',
    invalid: 'اسم المستخدم أو كلمة المرور غير صحيحة.',
    tabs: { fires: 'الحرائق', drones: 'الدرونات', insights: 'التحليل' } as Record<string, string>,
    noFires: 'لا توجد حرائق نشطة', noFiresLead: 'البلاغات الجديدة تظهر هنا مباشرة.',
    needs: '{n} × درون {agent}', launch: 'إطلاق {n} درونات', launch1: 'إطلاق درون', reinforce: 'إرسال تعزيز',
    shortage: '{n} غير متاح الآن', noneReady: 'لا يوجد درون مناسب جاهز', resolve: 'تم الإخماد',
    assigned: 'في المهمة', reported: 'وقت البلاغ',
    agents: { water: 'ماء', foam: 'فوم', powder: 'بودرة' } as Record<string, string>,
    phase: { ready: 'جاهزة', charging: 'تشحن', enroute: 'في الطريق', onscene: 'تطفئ', returning: 'راجعة' } as Record<string, string>,
    reason: { battery: 'البطارية أقل من 20% — ترجع لأقرب محطة', empty: 'خلصت المادة — ترجع للتعبئة', done: 'انتهت المهمة' } as Record<string, string>,
    battery: 'الشحن', payload: 'المادة', altitude: 'الارتفاع', distance: 'المسافة', eta: 'الوصول',
    hotspots: 'أماكن تكرار البلاغات', hotspotsLead: 'المربعات الحمراء = أماكن تكررت فيها البلاغات.',
    suggest: 'اقتراح محطة جديدة', suggestWhy: '{n} بلاغات · تبعد {m} م عن أقرب محطة', noSuggest: 'المحطات الحالية تغطي كل الأماكن.',
    stations: 'المحطات', ready: 'جاهزة', inAir: 'في الجو', active: 'حرائق نشطة', resolvedToday: 'أُخمدت (24 س)',
    s: 'ث', m: 'م', min: 'د', simulated: 'درونات محاكاة',
  },
  errors: {
    network: 'لا يوجد اتصال. تأكد من الإنترنت وحاول مرة أخرى.', api_unavailable: 'الخادم غير متاح حالياً. حاول بعد قليل.',
    rate_limited: 'بلاغات كثيرة. انتظر دقائق.', outside_campus: 'لازم يكون الموقع داخل الكلية.',
    validation: 'أكمل البيانات.', no_drones_available: 'لا يوجد درون مناسب جاهز.', not_found: 'هذا الحريق تم إغلاقه.',
    unauthenticated: 'انتهت الجلسة. سجّل الدخول مرة أخرى.', invalid: 'اسم المستخدم أو كلمة المرور غير صحيحة.', internal: 'خطأ في الخادم. حاول مرة أخرى.',
  } as Record<string, string>,
};
export default ar;
