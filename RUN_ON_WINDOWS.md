# מה להריץ אצלך במחשב

הכול כבר כתוב לפרויקט ונבדק (`npm run build` עבר, 80 בדיקות ירוקות).
נשארו ארבע פקודות שחייבות לרוץ על Windows — אין לי גישה להרצת פקודות
במחשב שלך, רק לכתיבת קבצים.

פתח PowerShell בתיקיית הפרויקט:

```powershell
cd "C:\Users\User\Documents\Love app tamar agmon"
```

---

## 1. מחיקת הנכסים המיותרים (~15MB מכל build)

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\remove-unused-assets.ps1 -WhatIf   # תצוגה מקדימה
powershell -ExecutionPolicy Bypass -File .\scripts\remove-unused-assets.ps1           # ביצוע
```

הקבצים עוברים ל**סל המיחזור**, לא נמחקים לצמיתות. הסקריפט בודק לפני כל
מחיקה שהקובץ באמת לא מופנה מהקוד, ומדלג אם כן. פרויקט האנימציה עצמו
(`adam-porat-graduation-animation/`) לא נוגעים בו — רק בעותקים ב־`public/`.

## 2. שדרוג מנוע התמלול

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\install-better-asr.ps1
```

מוריד את `whisper-turbo` בפורמט sherpa-onnx (~1.0GB) אל
`models\asr\whisper-turbo\`. האפליקציה מזהה אותו אוטומטית ומעדיפה אותו על
whisper-tiny — בלי שינוי קוד או הגדרה.

אם זה איטי מדי אצלך: `-Model small` (~0.4GB, עדיין הרבה יותר טוב מ־tiny).
לביטול: פשוט למחוק את התיקייה.

## 3. בנייה ובדיקות

```powershell
npm run build
npm test
```

## 4. Smoke test של אפליקציית Windows

```powershell
npm run desktop:smoke
```

זו הבדיקה היחידה שלא יכולתי להריץ — היא דורשת Electron על Windows.
היא מאמתת שה־origin הוא `couple-lab://app`, שמודלי MediaPipe נטענים,
ושגשר ה־IPC מחזיר סטטוס תקין.

---

## ואז — לראות שזה עובד

1. הפעל את Couple Lab מהקיצור בשולחן העבודה.
2. **הרץ מחדש את כיול הקול** (קריאת שני המשפטים). זה עכשיו גם מודד
   אוטומטית את דיוק התמלול ומשווה למודל הקודם — תראה משפט כמו
   *"בדיקת התמלול זיהתה 14 מתוך 15 מילים"*.
3. הקלט שיחת תרגול קצרה. בסיום אמורים להופיע:
   - **"רגעים ששווה לראות שוב"** — עד שלושה קטעים קצרים מההקלטה.
   - **איזון תורות** בתובנות — עובד עכשיו, אחרי שיוך הדובר האוטומטי.
4. ב־Insights, נסה את שדה החיפוש **"מה אמרנו על…"**.

אם משהו לא מופיע — הכי מהיר לשלוח לי את הייצוא מ־More ← אבחון.
