# שדרוג מנוע התמלול — drop-in, בלי שינוי קוד

**עודכן:** 2026-08-14

Electron סורק בהפעלה את `models/asr/` ובוחר אוטומטית את חבילת המודל הטובה ביותר:
כל תיקייה שמכילה `*encoder*.onnx`, `*decoder*.onnx` ו־`*tokens*.txt` היא חבילה תקינה,
וכל חבילה שאינה `whisper-tiny` מקבלת עדיפות. כלומר — כדי לשדרג את איכות
התמלול בעברית מספיק להניח תיקייה חדשה ולהפעיל מחדש.

## למה לשדרג

whisper-tiny int8 הוא רצפת האיכות של כל מנוע הניתוח. הפיין־טיון העברי של
ivrit.ai (Apache-2.0, ~5,050 שעות עברית) מדויק ממנו דרמטית. התמלול רץ אחרי
עצירת ההקלטה, לא בזמן אמת — לכן זמן פענוח ארוך יותר כמעט אינו מורגש.

## שלבים

1. להוריד או לייצא את המודל בפורמט sherpa-onnx (encoder/decoder ONNX + tokens):
   - מוכן מראש: חיפוש "ivrit whisper onnx" ב־Hugging Face (למשל
     `instush/ivrit-whisper-large-v3-turbo-timestamped-onnx`), או
   - ייצוא עצמי עם הסקריפט הרשמי:
     `https://k2-fsa.github.io/sherpa/onnx/pretrained_models/whisper/export-onnx.html`
     על `ivrit-ai/whisper-large-v3-turbo`.
2. ליצור תיקייה חדשה, למשל: `models/asr/ivrit-whisper-large-v3-turbo/`
   ולהניח בה את שלושת הקבצים. להוסיף `SOURCE.md` עם המקור וה־SHA-256.
3. להפעיל מחדש את Couple Lab. מסך האבחון יציג את ה־modelId החדש.
4. לאמת: להריץ שוב את כיול הקול (קריאת המשפטים) — תוצאת ה־WER של המודל
   החדש נשמרת אוטומטית ב־`couple-lab-transcription-calibration` ומושווית
   לישנה. אם ה־WER לא השתפר, פשוט למחוק את התיקייה.

## הערות

- גודל: חבילת large-v3-turbo היא ~1.5GB מול ~103MB של tiny. אם אורזים
  portable build, לשקול להשאיר את tiny כברירת מחדל בחבילה ולהניח את המודל
  הגדול רק בהתקנה המקומית (extraResources כבר מעתיק את כל `models/`).
- אין צורך בשינוי קוד או קונפיגורציה — הבחירה אוטומטית לפי תוכן התיקייה.
- ה־VAD (silero) נשאר זהה ואינו תלוי במודל התמלול.
