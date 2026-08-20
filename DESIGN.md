---
name: "Couple Lab"
description: "מרחב זוגי שקט שמוביל משאלה אחת לשיחה אחת."
colors:
  ink: "#20312c"
  mineral-bg: "#f2eee7"
  paper: "#fffdf9"
  muted: "#596660"
  divider: "#d8d4ca"
  forest: "#1f6259"
  forest-deep: "#174f48"
  forest-soft: "#dce9e3"
  clay: "#b85849"
  clay-soft: "#f6e3df"
  honey: "#e5b970"
  honey-hover: "#efc783"
typography:
  display:
    fontFamily: "Frank Ruhl Libre, Noto Serif Hebrew, Georgia, serif"
    fontSize: "clamp(2rem, 4vw, 4.2rem)"
    fontWeight: 560
    lineHeight: 1
    letterSpacing: "-0.025em"
  headline:
    fontFamily: "Frank Ruhl Libre, Noto Serif Hebrew, Georgia, serif"
    fontSize: "clamp(2rem, 3.2vw, 3.35rem)"
    fontWeight: 650
    lineHeight: 1.06
    letterSpacing: "-0.025em"
  body:
    fontFamily: "Segoe UI, Arial, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.6
  label:
    fontFamily: "Segoe UI, Arial, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.9rem"
    fontWeight: 700
    lineHeight: 1.3
  micro:
    fontSize: "0.75rem"
  small:
    fontSize: "0.875rem"
  lead:
    fontSize: "1.125rem"
  title:
    fontSize: "1.25rem"
  section:
    fontSize: "1.5rem"
  compactHeadline:
    fontSize: "1.75rem"
  mobileDisplay:
    fontSize: "2.25rem"
rounded:
  sm: "8px"
  md: "10px"
  lg: "14px"
  xl: "18px"
  hero: "24px"
  pill: "999px"
spacing:
  xs: "8px"
  sm: "14px"
  md: "20px"
  lg: "34px"
  xl: "48px"
components:
  button-primary:
    backgroundColor: "{colors.forest}"
    textColor: "{colors.paper}"
    rounded: "{rounded.sm}"
    padding: "14px 20px"
    height: "48px"
  button-primary-hover:
    backgroundColor: "{colors.forest-deep}"
    textColor: "{colors.paper}"
  button-secondary:
    backgroundColor: "{colors.forest-soft}"
    textColor: "{colors.ink}"
    rounded: "{rounded.sm}"
    padding: "12px 18px"
  input:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "12px 14px"
    height: "48px"
  navigation-active:
    backgroundColor: "{colors.forest-soft}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    height: "46px"
---

# Design System: Couple Lab

## Overview

**Creative North Star: "אינטימיות עריכתית שקטה"**

Couple Lab מרגיש כמו חדר פרטי ונעים לשני אנשים, לא כמו לוח בקרה ולא כמו מערכת טיפולית. הממשק משתמש במשטח מינרלי חם, אזורי עבודה ירוקים־עמוקים, טיפוגרפיה עברית עריכתית ותמונות אמיתיות כדי לתת לשיחה עצמה משקל.

הצפיפות נמוכה וההיררכיה מכוונת לפעולה אחת בכל רגע. מידע טכני, מדדים ופעולות משניות נסוגים אל שכבות מאוחרות; בזמן תרגול השאלה והמצלמה הן מוקד המסך.

**Key Characteristics:**

- משטח מינרלי חם עם אזורי forest כהים ומעט צבעי חמרה ודבש.
- כותרות עבריות עריכתיות מול טקסט תפעולי פשוט וקריא.
- מקטעים פתוחים ומפרידים דקים במקום פסיפס של כרטיסים.
- תמונות אמיתיות של בני הזוג ונכס איור אמיתי בהיכרות הראשונה.
- פעולה ראשית אחת ברורה, עם מעט הקלקות בזמן השיחה.

## Colors

הצבעים שקטים וטבעיים: הירוק העמוק מחזיק את מרחב העבודה, הרקע המינרלי מרכך אותו, וחמרה או דבש מופיעים רק כהכוונה או פעולה.

### Primary

- **יער עמוק:** צבע הפעולה הראשית, הווידאו הפעיל, בחירה ו־focus.
- **יער כהה:** מצב hover לפעולה הראשית.

### Secondary

- **חמרה מרוסנת:** אזהרות רכות, קישור מסוכן והדגשות נדירות.
- **דבש חם:** פעולה מזמינה יחידה על משטח היער בבית.

### Neutral

- **דיו ירקרק:** טקסט ראשי ומשטח הפעולה הגדול.
- **אבן מינרלית:** רקע האפליקציה.
- **נייר חם:** משטחי טופס ותוכן.
- **ערפל:** טקסט משני.
- **קו אבן:** מפרידים וגבולות עדינים.

**The Rare Accent Rule.** חמרה ודבש אינם צבעי מילוי כלליים; בכל מסך הם שמורים למסר או פעולה אחת בעלת משמעות.

**The Same-Hue Support Rule.** על משטח ירוק, טקסט משני מקבל גוון ירקרק בהיר ולא אפור ניטרלי.

## Typography

**Display Font:** Frank Ruhl Libre, self-hosted, עם Noto Serif Hebrew ו־Georgia כ־fallback.  
**Body Font:** Segoe UI, הזמין באופן מקומי ב־Windows, עם Arial ו־system-ui כ־fallback. אין להצהיר על גופן גוף שאינו נארז בפועל.

**Character:** הכותרות ספרותיות, אנושיות וקצת טקסיות; טקסט ההפעלה נשאר מודרני ושקוף. הניגוד ביניהם מייצר עולם עריכתי בלי לפגוע בקריאות בזמן שיחה.

### Hierarchy

- **Display:** משקל 560 וגודל fluid; לשאלה הפעילה ולפעולה הראשית בבית בלבד.
- **Headline:** משקל 650 וגודל fluid; לכותרת המסך ולרגעי מעבר.
- **Title:** serif במשקל 650; לכותרות מקטע קצרות.
- **Body:** sans רגיל, line-height מרווח; הסברים נשמרים בדרך כלל עד 64–65 תווים.
- **Label:** sans מודגש; לפעולות, שמות ומצבים בלבד.

**The One Serif Moment Rule.** בכל אזור יש כותרת serif דומיננטית אחת; טקסטי עזר ופקדים נשארים sans.

**The Heading Speaks Rule.** אין eyebrow או kicker מעל כותרת. אם ההקשר נחוץ, הוא נכנס למשפט העזר שמתחתיה.

## Layout

במחשב מעטפת האפליקציה מחלקת את המסך לסרגל צד קבוע של 228px ולתוכן ברוחב מרבי של 1480px. התוכן משתמש במקטעים פתוחים, מרווחים נדיבים וקווים דקים; לא כל קבוצה מקבלת כרטיס.

הבית מציב את זהות הזוג, הזמנה ראשית רחבה ושני אזורי סיכום משניים. מסך התרגול משתמש בשני טורים: המצלמה היא הטור הרחב והדביק, והשאלה והפקדים בטור המשני. גובה המצלמה תלוי ב־viewport וכפתורי ההתחלה והעצירה נמצאים בקבוצה עצמאית מיד מתחתיה. מתחת ל־1120px סרגל הצד הופך לכותרת ניווט אופקית; מתחת ל־900px התרגול הופך לטור יחיד והשאלה מופיעה לפני המצלמה; מתחת ל־760px הניווט עובר למסילה תחתונה קבועה, המצלמה מקבלת יחס 16:9 והפקדים נשארים מעל המסילה.

**The Conversation First Rule.** בזמן תרגול השאלה והמצלמה חייבות להופיע לפני תמלול, ניתוח והגדרות מתקדמות.

## Elevation & Depth

המערכת שטוחה כברירת מחדל. עומק מגיע מניגוד טונאלי, חפיפה אמיתית ומעט צל ambient רחב על רגעים בודדים: איור ההיכרות, במת המצלמה וכפתור ראשי. אין שילוב של מסגרת מודגשת וצל רחב על אותו משטח.

### Shadow Vocabulary

- **Ambient hero:** `0 18px 50px rgba(32, 49, 44, 0.09)` — לנכס ההיכרות בלבד.
- **Live stage:** `0 20px 60px rgba(25, 26, 23, 0.16)` — לבמת המצלמה.
- **Primary action:** `0 8px 24px rgba(31, 98, 89, 0.18)` — לכפתור ראשי על רקע בהיר.

**The Flat-by-Default Rule.** מקטע תוכן רגיל מופרד בגוון או בקו, לא בצל.

## Shapes

הרדיוסים קטנים ומדורגים: 8–10px לפקדים, 14px לכרטיסי תוכן, 18px לבמת וידאו ו־24px לנכס hero. עיגולים שמורים לתמונות פרופיל; pills שמורים לתגיות ובקרי מצב קטנים.

קווים הם דקים ושקטים. אין פס צד צבעוני עבה, אין צל קשיח ואין אפקט חומר מזויף.

## Components

### Buttons

- **Shape:** מלבן רך ברדיוס קטן, יעד מגע של 44px לפחות; הפעולה הראשית ושדות הטופס הם 48px.
- **Primary:** forest על paper, או honey נדיר על משטח ink.
- **Hover / Focus:** שינוי טונאלי קטן, תזוזה של 1px ו־focus-visible ברור.
- **Secondary / Text:** משטח forest-soft או קישור שקוף; פעולה מסוכנת משתמשת בחמרה ובמילים מפורשות.

### Cards / Containers

- **Corner Style:** 14px כאשר באמת דרוש container.
- **Background:** paper חם או forest כהה למוקד יחיד.
- **Shadow Strategy:** ללא צל ברוב המקרים; ראו Elevation & Depth.
- **Border:** קו 1px בלבד.
- **Internal Padding:** 20–34px לפי חשיבות ורוחב.

### Inputs / Fields

- **Style:** paper, קו אבן, רדיוס 10px וגובה 48px לפחות.
- **Focus:** טבעת focus בגוון forest; אין להסתמך על צבע בלבד.
- **Error / Disabled:** רקע clay-soft או opacity יחד עם טקסט שמסביר את הבעיה וההתאוששות.

### Navigation

במחשב סרגל הצד מציג שישה יעדים לפי סדר העבודה: בית, תרגול, תובנות, מדריך, דוח ועוד. ברוחבי ביניים הוא הופך לשורת ניווט עליונה. במובייל נשארים ארבעה יעדים במסילה התחתונה: בית, תרגול, תובנות ועוד. מדריך, דוח, הגדרות, מפת הקשר, בטיחות וסודיות וכלי תמיכה נמצאים תחת עוד. מצב פעיל מקבל forest-soft, צבע ink ואייקון Lucide עקבי.

### Live Conversation Stage

במת המצלמה היא המשטח הגדול והכהה ביותר. הודעת הרשאה או איכות מופיעה בתוכה, בעוד בקרי התחלה, עצירה והסכמה נשארים מתחתיה כדי לא להסתיר פנים או את השיחה. במובייל, בזמן הקלטה או שמירה, קבוצת הפקדים כולה נשארת קבועה מעל הניווט התחתון.

### Brand Mark

סמל הלב־שיחה שב־`public/app-icon.*` וב־`public/favicon.svg` הוא סמל המעטפת היחיד: הוא מופיע באפליקציה, בכרטיסיית הדפדפן, ב־PWA, בחלון Windows ובקיצור הדרך. `og.png` הוא איור שיווקי רחב ואינו לוגו חלופי. צבעי הסמל נשארים בגבולות forest/clay ואין להציג לידו סמל מתחרה.

## Do's and Don'ts

### Do:

- **Do** הציגו פעולה ראשית אחת בכל רגע והעבירו מורכבות לשלב שבו היא נחוצה.
- **Do** השתמשו בתמונה האמיתית של כל בן/בת זוג כאשר היא קיימת.
- **Do** שמרו את השאלה והמצלמה יחד בתחילת תרגול גם ברוחב קטן.
- **Do** כתבו בעברית אנושית, רגועה ולא־קלינית.
- **Do** השתמשו באייקוני Lucide באותו משקל וקנה מידה.

### Don't:

- **Don't** החזירו פסיפס של כרטיסי metric, ציונים או פעולות לבית.
- **Don't** הציגו vectors, models, Windows או מונחי implementation במסלול הראשי.
- **Don't** הוסיפו eyebrow, gradient text, glass, צל קשיח או פס צד עבה.
- **Don't** השתמשו ב־emoji או glyph טקסטואלי במקום אייקון.
- **Don't** הציגו רמזי מצלמה או קול כאבחון של רגש, כוונה או אמת זוגית.
