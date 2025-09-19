# תיק פרויקט: מערכת ניהול שכר ועובדים

**גרסה: 1.4.3**
**תאריך עדכון אחרון: 2025-09-19**

## 1. חזון ומטרה

מטרת הפרויקט היא לספק פתרון אפליקטיבי, נוח ויעיל לניהול תשלומי שכר לעובדים, כתחליף לקובץ אקסל שהיה מועד לטעויות. המערכת מותאמת אישית לצרכים של עסק עם שני סוגי עובדים עיקריים: עובדים שעתיים ומדריכים המקבלים תשלום פר-סשן.

**דרישות מפתח:**
- ממשק פשוט ואינטואיטיבי בעברית.
- יכולת להגדיר תעריפים דינמיים ומשתנים לאורך זמן.
- ניהול גמיש של סוגי שירותים (סשנים) שהמדריכים יכולים לבצע.
- דוחות מדויקים ואינטראקטיביים.
- שמירה על דיוק היסטורי של נתונים פיננסיים.

---

## 2. ארכיטקטורה וטכנולוגיות

המערכת בנויה בארכיטקטורת שרת-לקוח מודרנית, ארוזה כאפליקציית דסקטופ עצמאית.

*   **מעטפת אפליקציית דסקטופ:**
    *   **Framework:** Electron
    *   **כלי אריזה:** electron-builder
    *   **תכונות:** כולל Launcher מותאם אישית לפתיחת האפליקציה בחלון משלה או בדפדפן ברירת המחדל של המשתמש.

*   **Frontend (צד לקוח):** אפליקציית Single Page Application (SPA) שנבנתה באמצעות:
    *   **Framework:** React
    *   **ניתוב:** React Router (`HashRouter` לתאימות עם דסקטופ)
    *   **כלי בנייה:** Vite
    *   **עיצוב:** Tailwind CSS
    *   **ספריית רכיבים:** shadcn/ui

*   **Backend ובסיס נתונים:**
    *   **פלטפורמה:** Supabase (Backend-as-a-Service)
    *   **בסיס נתונים:** PostgreSQL
    *   **API:** נוצר אוטומטית על ידי Supabase (PostgREST).

*   **ניהול תצורה:**
    *   מפתחות ה-API מנוהלים באמצעות קובץ `.env` מקומי לאבטחה, מה שמבטיח שמידע רגיש לא נשמר במערכת ניהול הגרסאות.

---

## 3. מבנה בסיס הנתונים (Database Schema)

זהו לב המערכת. בסיס הנתונים מורכב מארבע טבלאות מרכזיות:

### 3.1. טבלת `Employees`
מכילה מידע כללי על כל עובד.

| עמודה | סוג | תיאור | אילוצים |
| :--- | :--- | :--- | :--- |
| `id` | `uuid` | מזהה ייחודי אוטומטי | **Primary Key** |
| `name` | `text` | שם מלא של העובד | Not NULL |
| `employee_type`| `text` | סוג עובד ('hourly', 'instructor', 'global') | Not NULL |
| `current_rate`| `numeric`| תעריף שעתי או חודשי נוכחי | |
| `working_days` | `jsonb` | מערך של ימי עבודה (למשל `["SUN","MON"]`) | ברירת מחדל: `["SUN","MON","TUE","WED","THU"]` |
| `is_active` | `boolean`| האם העובד פעיל כרגע | Default: `true` |
| ... | ... | שדות נוספים: `employee_id`, `phone`, `email`, `start_date`, `notes` | |

### 3.2. טבלת `Services`
מכילה את הרשימה הדינמית של שירותים/סשנים שמדריכים יכולים לבצע.

| עמודה | סוג | תיאור | אילוצים |
| :--- | :--- | :--- | :--- |
| `id` | `uuid` | מזהה ייחודי אוטומטי | **Primary Key** |
| `name` | `text` | שם השירות (למשל, "רכיבה טיפולית 30 דק'") | Not NULL |
| `duration_minutes`| `int8` | משך השירות בדקות (לצורך חישוב שעות) | |
| `payment_model`| `text` | מודל תשלום ('fixed_rate' או 'per_student') | Not NULL |
| `color` | `text` | קוד צבע הקסדצימלי (למשל, `#8B5CF6`) לתצוגה בממשק | |

### 3.3. טבלת `RateHistory`
הטבלה הקריטית ביותר. שומרת את יומן התעריפים ההיסטורי לכל עובד ושירות.

| עמודה | סוג | תיאור | אילוצים |
| :--- | :--- | :--- | :--- |
| `id` | `uuid` | מזהה ייחודי אוטומטי | **Primary Key** |
| `employee_id` | `uuid` | מצביע לטבלת `Employees` | **Foreign Key** |
| `service_id` | `uuid` | מצביע לטבלת `Services` | **Foreign Key** |
| `rate` | `numeric` | סכום התעריף | Not NULL |
| `effective_date`| `date` | התאריך שממנו התעריף הזה נכנס לתוקף | Not NULL |
| `notes` | `text` | הערות על שינוי התעריף | |
| **אילוץ ייחודיות משולב** | `UNIQUE` | על העמודות: `employee_id`, `service_id`, `effective_date` | |

### 3.4. טבלת `WorkSessions`
יומן העבודה. כל שורה מייצגת סשן עבודה שהושלם.

| עמודה | סוג | תיאור | אילוצים |
| :--- | :--- | :--- | :--- |
| `id` | `uuid` | מזהה ייחודי אוטומטי | **Primary Key** |
| `employee_id` | `uuid` | מצביע לטבלת `Employees` | **Foreign Key** |
| `service_id` | `uuid` | מצביע לטבלת `Services` (למדריכים) | **Foreign Key** |
| `date` | `date` | תאריך ביצוע העבודה | Not NULL |
| `entry_type` | `text` | 'session', 'hours', 'adjustment', 'paid_leave' | Not NULL |
| `hours` | `numeric` | מספר שעות (שדה תצוגה בלבד בגלובלי) | |
| `sessions_count`| `int8` | מספר מפגשים (למדריכים) | |
| `students_count`| `int8` | מספר תלמידים (למודל `per_student`) | |
| `rate_used` | `numeric`| "תמונת מצב" של התעריף שהיה בשימוש בזמן החישוב | |
| `total_payment`| `numeric`| "תמונת מצב" של הסכום הסופי שחושב | |

#### כללי חישוב ב-WorkSessions

- `rate_used` נטען מטבלת `RateHistory` בכל יצירה או עדכון. מדריכים מחשבים לפי `(employee_id, service_id, date)`; עובדים שעתיים וגלובליים לפי `(employee_id, date)`.
- עבור רישומי מדריכים `service_id` הוא חובה. אם אין תעריף תקף לתאריך – הפעולה נחסמת עם הודעת שגיאה.
- `effectiveWorkingDays(employee, month)` סופר את ימי החודש בהם היום בשבוע כלול ב-`employee.working_days`. אם התוצאה היא `0` – השמירה נחסמת עם הודעה ברורה.
- `total_payment` מחושב ונשמר בכל שורה:
  - מדריכים: `sessions_count * students_count * rate_used` (או ללא תלמידים כאשר התשלום אינו פר תלמיד).
  - עובדים שעתיים: `hours * rate_used`.
  - עובדים גלובליים: `rate_used / effectiveWorkingDays(employee, month)` (כל שורה מייצגת יום אחד; שדה השעות אינו משפיע וריבוי רישומים באותו יום לא מכפיל שכר).
  - חופשה בתשלום: אותו תעריף יומי כמו לעובד גלובלי, נשמר עם `entry_type='paid_leave'`.
- סיכומי חודש ודוחות מתבססים אך ורק על סכימת `total_payment` משורות `WorkSessions`, תוך סיכום רישומי גלובלי לפי יום אחד.
- היעדרות ללא תשלום = אין שורה. חופשה בתשלום נרשמת כשורה נפרדת מסוג `paid_leave`.
- כל רישום יכול לכלול שדה הערות חופשי (עד 300 תווים).

### 3.5. טבלת `Settings`
מאחסנת הגדרות רוחב-ארגון הנשמרות לפי מפתח קבוע.

| עמודה | סוג | תיאור | אילוצים |
| :--- | :--- | :--- | :--- |
| `id` | `uuid` | מזהה ייחודי אוטומטי | **Primary Key** |
| `key` | `text` | מזהה ההגדרה (למשל `leave_policy`) | **Unique** |
| `settings_value` | `jsonb` | מטען JSON מובנה של ההגדרה | Not NULL |
| `created_at` | `timestamptz` | חותמת יצירה | ברירת מחדל: `now()` |
| `updated_at` | `timestamptz` | חותמת עדכון אחרונה | ברירת מחדל: `now()` |

רשומת `leave_policy` מכילה את תצורת ניהול החופשות המשמשת בכל חלקי המערכת:

- `allow_half_day` – מאפשר לעובדים לצרוך 0.5 יום בכל פעולה.
- `allow_negative_balance` – מאפשר חריגה למינוס עד הגבול המוגדר.
- `negative_floor_days` – היתרה המינימלית המותרת (ערך שלילי מציין כמה אפשר לרדת מתחת לאפס).
- `carryover_enabled` / `carryover_max_days` – שליטה על העברת יתרות חיוביות לשנה הבאה.
- `holiday_rules[]` – מערך של אובייקטים `{ id, name, type, start_date, end_date, recurrence }` שמגדירים טווחי חגים ומסווגים אותם כחג משולם ע"י המערכת, חופשה מהמכסה, לא משולם, מעורב או חצי יום.

יש להשתמש בפונקציות העזר שב-`src/lib/leave.js` לכל פעולת קריאה/כתיבה כדי לנרמל את ה-JSON ולשמור על עקביות מזהים.

### 3.6. טבלת `LeaveBalances`
משמשת כספר תנועות בלתי הפיך להקצאות חופשה ולניצולים בפועל.

| עמודה | סוג | תיאור | אילוצים |
| :--- | :--- | :--- | :--- |
| `id` | `bigint` | מזהה רץ אוטומטי | **Primary Key** |
| `employee_id` | `uuid` | מצביע לטבלת `Employees` | **Foreign Key** |
| `leave_type` | `text` | תיאור סוג התנועה (למשל `allocation`, `usage_employee_paid`, `time_entry_leave_employee_paid`) | Not NULL |
| `balance` | `numeric` | ערכים חיוביים מוסיפים מכסה, ערכים שליליים מנכים ניצול | Not NULL, ברירת מחדל `0` |
| `effective_date` | `date` | תאריך ההשפעה של התנועה | Not NULL |
| `notes` | `text` | פרטים חופשיים אופציונליים | |
| `created_at` | `timestamptz` | חותמת יצירה | ברירת מחדל: `now()` |

הרישומים תומכים בערכים שבריים (למשל `-0.5` עבור חצי יום כשמאופשר במדיניות). רישומי ניכוי נבדקים מול רצפת המינוס שהוגדרה; ניסיון לרדת מעבר לגבול יציג את הטוסט "חריגה ממכסה ימי החופשה המותרים" ויחסם.

### מצב הזנה מרובה

ניתן להפעיל מצב **"בחר תאריכים להזנה מרובה"** בטבלה, לבחור עובדים ותאריכים, וללחוץ **"הזן"** כדי לפתוח מודאל המציג את כל התאריכים כרשימת טפסים קטנים—שורה אחת לכל תאריך ולעובד. לצד כל שדה מופיע כפתור **"העתק מהרישום הקודם"**.
עובדים גלובליים רואים שדה שעות לצורכי תצוגה בלבד ויכולים לבחור בין "יום רגיל" ל"חופשה בתשלום"; השכר מחושב תמיד לפי יום אחד לכל שורה.
שמירה יוצרת רשומת `WorkSessions` עבור כל צירוף של עובד ותאריך שנבחר.

### ייבוא נתונים בעברית

מודל הייבוא מאפשר להדביק טקסט או להעלות קובץ `.csv`. שורות שמתחילות ב-`#` יזוהו כהערות וידולגו. העובד נבחר בתוך המודל ואין לכלול עמודת עובד בקובץ. המערכת מזהה אוטומטית את המפריד (פסיק / TAB / נקודה-פסיק / קו-אנכי) וניתן לבחור מפריד ידנית.

**מיפוי כותרות**

| עברית            | שדה פנימי |
|------------------|-----------|
| תאריך           | `date` (DD/MM/YYYY → YYYY-MM-DD) |
| סוג רישום       | `entry_type` (`שיעור`=`session`, `שעות`=`hours`, `התאמה`=`adjustment`, `חופשה בתשלום`=`paid_leave`) |
| שירות           | `service_name` |
| שעות            | `hours` |
| מספר שיעורים    | `sessions_count` |
| מספר תלמידים    | `students_count` |
| סכום התאמה      | `adjustment_amount` |
| הערות           | `notes` |

התצוגה המקדימה מציגה עד 100 שורות עם הודעות שגיאה לכל שורה. שורות כפולות מסומנות ומדולגות אלא אם המשתמש בוחר לייבא אותן בכל זאת.

**תבניות**

כפתורי הורדה מספקים תבנית CSV (עם BOM) ותבנית אקסל בסיסית. שני הקבצים כוללים שורות הוראות ודוגמאות מסומנות "(דוגמה)" שיש למחוק לפני הייבוא.

**כללי ולידציה**

- `date` חייב להיות תקין.
- `session` דורש `service_name`, `sessions_count` ≥1, `students_count` ≥1 ותעריף תקף.
- `hours` דורש תעריף; עובד שעתי חייב שעות, עובד גלובלי משתמש בתעריף יומי ללא קשר לשעות.
- `paid_leave` מותר רק לעובד גלובלי ומשתמש בתעריף היומי הגלובלי.
- `adjustment` דורש `adjustment_amount` ומתעלם משדות אחרים.

רק שורות תקינות נשלחות לטבלת `WorkSessions`; בסיום מוצג סיכום של שורות שהוזנו, שגויות ומדולגות.

### עורך יום גלובלי
- בעת עריכת עובד גלובלי ביום מסוים, מוצג כותר יום עם בורר סוג יום יחיד ורשימת מקטעי שעות. הוספת מקטע אינה מכפילה שכר, ומחיקת המקטע האחרון נחסמת עם הודעה.
- בטבלת החודש מוצג סכום השעות לכל יום גלובלי כ-`X שעות`, כאשר השכר נספר פעם אחת בלבד ליום.

---

## 4. החלטות ארכיטקטוניות ומסקנות (Lessons Learned)

במהלך הפיתוח התקבלו מספר החלטות מפתח שעיצבו את המערכת:

1.  **שימוש בטבלת `RateHistory` נפרדת:** במקום להוסיף עמודות תעריפים לטבלת `Employees`.
    *   **היגיון:** זה מספק גמישות אינסופית להוספת שירותים חדשים מבלי לשנות את סכמת בסיס הנתונים. והכי חשוב, זה שומר על **היסטוריית תעריפים מדויקת**, שחיונית לחישובים רטרואקטיביים.
    *   **מסקנה:** דיוק היסטורי בנתונים פיננסיים גובר על הפשטות של מבנה נתונים "שטוח".

2.  **שימוש ב-`upsert` עם `onConflict` משולב:** כדי למנוע רשומות תעריפים כפולות לאותו היום, הגדרנו אילוץ ייחודיות על השילוב של `employee_id`, `service_id`, ו-`effective_date`.
    *   **היגיון:** זה מאפשר לנו להשתמש בפקודת `upsert` יעילה ש"דורסת" שינויים שנעשו באותו היום, ובכך מונעת "בלגן" בבסיס הנתונים ושומרת על "מקור אמת אחד" לכל יום נתון.
    *   **מסקנה:** שימוש נכון באילוצים (constraints) בבסיס הנתונים מפשט את הלוגיקה בקוד ומונע באגים.

3.  **הפיכת רכיבים ל"חכמים" ועצמאיים:** באג שבו טופס עריכת העובד לא הציג תעריפים מעודכנים נפתר על ידי הפיכת `EmployeeForm` לרכיב שאחראי להביא את הנתונים העדכניים שלו בעצמו, במקום להסתמך על מידע שעלול להיות "ישן" מהרכיב האב.
    *   **מסקנה:** חיוני לנהל את ה-state בחוכמה ולהבטיח שרכיבים תמיד עובדים עם המידע העדכני ביותר שהם צריכים.

4.  **תעדוף חווית המשתמש (UX):** התלבטנו רבות לגבי התנהגות טפסים, במיוחד במעבר בין סוגי עובדים.
    *   **ההחלטה:** במקום איפוס טופס מלא, יישמנו "איפוס חלקי חכם" והוספנו `AlertDialog` מעוצב כדי לתת למשתמש שליטה מלאה על פעולות שעלולות לגרום לאיבוד מידע.
    *   **מסקנה:** חווית משתמש טובה דורשת חשיבה על מקרי קצה והימנעות מהתנהגויות אוטומטיות שעלולות לתסכל את המשתמש.

5.  **ניהול מרוכז של היסטוריית תעריפים:** רכיב `RateHistoryManager` הייעודי מאפשר להוסיף או לערוך רשומות היסטוריית תעריפים ישירות מתוך טופס העובד; מחיקה אינה זמינה כדי לשמור על עקבות.
    *   **מסקנה:** ריכוז עריכת התעריפים במקום אחד שומר על נתוני השכר עקביים ושקופים.

---

## 5. מדריך התקנה ופריסה

מדריך זה מיועד למפתח (או AI) חדש שמצטרף לפרויקט וצריך להקים את סביבת הפיתוח מאפס.

### הגדרת סביבת פיתוח

1.  **שכפל את המאגר:** `git clone [כתובת המאגר]`
2.  **התקן תלויות:** `npm install`
3.  **הקם פרויקט ב-Supabase:**
    *   צור פרויקט חדש ב-`supabase.com`.
    *   צור את 4 הטבלאות (`Employees`, `Services`, `RateHistory`, `WorkSessions`) כפי שמפורט בסעיף 3.
    *   ודא שכל ה-`Primary Keys`, `Foreign Keys`, וה-`Constraints` מוגדרים כראוי.

### בסיס אבטחה ל-Supabase (Row Level Security)

בכל פרויקט של לקוח חייבים להפעיל Row Level Security (RLS) כדי שרק משתמשים מחוברים יוכלו לקרוא או לעדכן נתונים. עוזר ההקמה במסך ההגדרות (Settings → אבטחת Supabase) מציג את ה-SQL הבא עם כפתור העתקה:

```
-- Baseline RLS for Employee Management (single-tenant)
-- Run in the Supabase SQL editor while connected as the project owner.

ALTER TABLE public."Employees" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated select Employees" ON public."Employees"
  FOR SELECT TO authenticated
  USING (true);
CREATE POLICY "Authenticated insert Employees" ON public."Employees"
  FOR INSERT TO authenticated
  WITH CHECK (true);
CREATE POLICY "Authenticated update Employees" ON public."Employees"
  FOR UPDATE TO authenticated
  USING (true)
  WITH CHECK (true);
CREATE POLICY "Authenticated delete Employees" ON public."Employees"
  FOR DELETE TO authenticated
  USING (true);

ALTER TABLE public."WorkSessions" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated select WorkSessions" ON public."WorkSessions"
  FOR SELECT TO authenticated
  USING (true);
CREATE POLICY "Authenticated insert WorkSessions" ON public."WorkSessions"
  FOR INSERT TO authenticated
  WITH CHECK (true);
CREATE POLICY "Authenticated update WorkSessions" ON public."WorkSessions"
  FOR UPDATE TO authenticated
  USING (true)
  WITH CHECK (true);
CREATE POLICY "Authenticated delete WorkSessions" ON public."WorkSessions"
  FOR DELETE TO authenticated
  USING (true);

ALTER TABLE public."LeaveBalances" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated select LeaveBalances" ON public."LeaveBalances"
  FOR SELECT TO authenticated
  USING (true);
CREATE POLICY "Authenticated insert LeaveBalances" ON public."LeaveBalances"
  FOR INSERT TO authenticated
  WITH CHECK (true);
CREATE POLICY "Authenticated update LeaveBalances" ON public."LeaveBalances"
  FOR UPDATE TO authenticated
  USING (true)
  WITH CHECK (true);
CREATE POLICY "Authenticated delete LeaveBalances" ON public."LeaveBalances"
  FOR DELETE TO authenticated
  USING (true);

ALTER TABLE public."RateHistory" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated select RateHistory" ON public."RateHistory"
  FOR SELECT TO authenticated
  USING (true);
CREATE POLICY "Authenticated insert RateHistory" ON public."RateHistory"
  FOR INSERT TO authenticated
  WITH CHECK (true);
CREATE POLICY "Authenticated update RateHistory" ON public."RateHistory"
  FOR UPDATE TO authenticated
  USING (true)
  WITH CHECK (true);
CREATE POLICY "Authenticated delete RateHistory" ON public."RateHistory"
  FOR DELETE TO authenticated
  USING (true);

ALTER TABLE public."Services" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated select Services" ON public."Services"
  FOR SELECT TO authenticated
  USING (true);
CREATE POLICY "Authenticated insert Services" ON public."Services"
  FOR INSERT TO authenticated
  WITH CHECK (true);
CREATE POLICY "Authenticated update Services" ON public."Services"
  FOR UPDATE TO authenticated
  USING (true)
  WITH CHECK (true);
CREATE POLICY "Authenticated delete Services" ON public."Services"
  FOR DELETE TO authenticated
  USING (true);

ALTER TABLE public."Settings" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated select Settings" ON public."Settings"
  FOR SELECT TO authenticated
  USING (true);
CREATE POLICY "Authenticated insert Settings" ON public."Settings"
  FOR INSERT TO authenticated
  WITH CHECK (true);
CREATE POLICY "Authenticated update Settings" ON public."Settings"
  FOR UPDATE TO authenticated
  USING (true)
  WITH CHECK (true);
CREATE POLICY "Authenticated delete Settings" ON public."Settings"
  FOR DELETE TO authenticated
  USING (true);
```

**אימות:** לאחר הרצת ה-SQL, חזור לעוזר ההקמה ולחץ על "בדוק מדיניות". הפעולה מבצעת קריאות קריאה בלבד שמוודאות שמשתמש מחובר מקבל גישה בעוד שבקשה אנונימית מקבלת סטטוס 401/403. המשך הלאה רק כאשר כל הטבלאות מוצגות עם תגית ירוקה של "מאובטח".
4.  **צור קובץ סביבה:**
    *   בתיקייה הראשית של הפרויקט, צור קובץ חדש בשם `.env`.
    *   הוסף את פרטי הגישה ל-Supabase לקובץ זה:
        ----------------------------------------------------------------
        VITE_SUPABASE_URL=https://<your-project-id>.supabase.co
        VITE_SUPABASE_ANON_KEY=<your-anon-key>
        ----------------------------------------------------------------
    *   **חשוב:** קובץ ה-`.env` נמצא ב-`.gitignore` ולא יישמר בגיט.
5.  **הרץ את אפליקציית הפיתוח:**
    -----------------------
    npm run electron:dev
    -----------------------
    פעולה זו תפעיל את האפליקציה בחלון דסקטופ עם טעינה חמה (hot-reloading).

### בנייה ל-Production

1.  **הרץ את פקודת הבנייה:**
    -----------------------
    npm run electron:build
    -----------------------
2.  פקודה זו תבצע:
    *   בנייה של אפליקציית ה-React לתיקיית `/dist`.
    *   אריזה של האפליקציה עם Electron לקובץ התקנה הפעלה.
3.  קובץ ההתקנה/האפליקציה הסופי ימוקם בתיקיית `/release` (שנוצרת מחוץ לתיקיית הפרויקט).

## 6. ניהול חופשות וחגים

מודול החופשות מרכז את כל כללי החגים, מכסות והספר הכפול כדי שכל חלקי המערכת יתבססו על אמת אחת.

### 6.1. הגדרות מנהל

- מסך **"חגים וימי חופשה"** תחת הגדרות עורכת את ה-JSON של `leave_policy` שתואר בסעיף 3.5.
- המתגים מוצגים עם הטקסטים: "אישור חצי יום", "היתרה יכולה לרדת למינוס", "כמות חריגה מימי החופש המוגדרים", "העברת יתרה לשנה הבאה" ו-"מקסימום להעברה".
- שורות חגים כוללות שם, טווח תאריכים ותגית מתוך:
  - `system_paid` → "חג משולם (מערכת)" (אין ניכוי, השכר מסומן כמשולם ע"י הארגון).
  - `employee_paid` → "חופשה מהמכסה" (ניכוי מהמכסה של העובד).
  - `unpaid` → "לא משולם".
  - `mixed` → "מעורב".
  - `half_day` → "חצי יום" (זמין רק כאשר חצי יום מאושר במדיניות).
- את השמירה מבצעים באמצעות `upsert` בטבלת `Settings` כדי למנוע כפילויות מפתח.

### 6.2. מכסה לעובד ופרו-רייטה

- לכל עובד נוסף שדה `annual_leave_days`. הפונקציה `computeEmployeeLeaveSummary` מחשבת פרו-רייטה לפי `start_date` וכמות הימים שנותרו בלוח השנה.
- העברת יתרות לשנה הבאה מתבצעת אוטומטית כשהיא פעילה ומוגבלת ל-`carryover_max_days`.
- הנתונים המסוכמים כוללים `quota`, `used`, `carryIn`, `remaining` ו-`adjustments` להצגה אחידה בלוחות בקרה.

### 6.3. רישום ניצולים

- לשונית החופשות מציעה שתי פעולות מהירות: הקצאה חיובית וניכוי לפי סוג חג.
- ניכוי יוצר `balance` שלילי ב-`LeaveBalances` עם `leave_type` כגון `usage_employee_paid` או `time_entry_leave_employee_paid`. הקצאה מוסיפה `balance` חיובי עם `leave_type='allocation'`.
- כאשר `allow_half_day` כבוי, הממשק חוסם ערכים שאינם שלמים. כאשר הוא פעיל, חגים מסוג חצי יום ממלאים אוטומטית `-0.5`.
- חריגה מעבר לגבול `negative_floor_days` נחסמת ומציגה את הטוסט **"חריגה ממכסה ימי החופשה המותרים"**.
- ימי `holiday_paid_system` מסומנים בטבלת השכר כמשולמים ללא יצירת רישום שלילי, כדי לשמור על התאמה עם סיכומי WorkSessions.

### 6.4. בוררי מידע משותפים

- `selectHolidayForDate(policy, date)` מאתר את כלל החג הרלוונטי לצורך חסימת תאריכים בתאריכון וסימון בטבלאות השכר.
- `selectLeaveRemaining(employeeId, date, context)` משתמש ב-`computeEmployeeLeaveSummary` ועליו להניע את מסכי העובדים, הדוחות והשכר כדי לשמור על יתרות זהות.
- אותן פונקציות מגובות בבדיקות יחידה שב-`test/leave.test.js` המגנות על חישובי הפרו-רייטה ועל אכיפת רצפת המינוס.

## עדכונים אחרונים

- ניהול מדיניות חופשות מרוכז במסך הגדרות חדש, כולל תגיות חג ובקרות חריגה למינוס.
- יתרות חופשה נשענות על ספר התנועות `LeaveBalances` עם פרו-רייטה שנתית והגבלת carry-over.
- הדוחות וטבלת השכר משתמשים בבוררי החופשות המשותפים כדי לשמור על עקביות בין ימי חג משולמים ליתרות עובדים.
- מסנני התאריכים בדוחות תומכים בהקלדה או בבחירה מהיומן ומכירים פורמטים מרובים.
- KPI השעות נספר רק עבור עובדים שעתיים, והמסנן כולל גם עובדים גלובליים.
- דו"ח הרישומים המפורטים מאפשר קיבוץ לפי סוג עובד עם סכומי ביניים.

