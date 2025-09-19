# תיק פרויקט: מערכת ניהול שכר ועובדים

**גרסה: 1.5.1**
**תאריך עדכון אחרון: 2025-10-06**

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
    *   האישורים נטענים בזמן ריצה מקובץ `public/runtime-config.json` (או מהזרקה של `window.__EMPLOYEE_MANAGEMENT_PUBLIC_CONFIG__`), קובץ שנמצא ברשימת ההתעלמות של Git ולכן אינו מחיל מפתחות Supabase בבילד.
    *   כתובות Supabase ומפתחות anon ארגוניים נשלפים לפי דרישה דרך פונקציית Azure `/api/config`, הדורשת את משתני הסביבה `APP_SUPABASE_URL` ו-`APP_SUPABASE_SERVICE_ROLE`.

### 2.1 מודל ארגון וחברות

- המערכת מחזיקה פרויקט Supabase ייעודי למטא-דאטה של האפליקציה. הטבלאות המרכזיות הן `app_organizations`, `app_org_memberships` ו-`app_org_invitations`.
- בכל רשומת ארגון נשמר חיבור ה-Supabase (`supabase_url`, `supabase_anon_key`), רשימת `policy_links` (מחרוזות URL), והגדרות משפטיות (JSON עם מייל איש קשר, תנאי שימוש ומדיניות פרטיות) לצד דגלי `setup_completed` ו-`verified_at`.
- רשומת חברות מקשרת `user_id` ממנגנון Supabase Auth לארגון בודד ולתפקיד (`admin`/`member`). החלפת ארגון מחליפה בזמן אמת את לקוח ה-Supabase שבשימוש האפליקציה.
- טבלת ההזמנות שומרת כתובות מייל ממתינות. מנהלים יכולים להזמין, לבטל הזמנה או להסיר חברים (למעט עצמם) מתוך **הגדרות → חברי ארגון**.
- לאחר ההתחברות `OrgProvider` טוען את החברויות, שומר ב-`localStorage` את הארגון האחרון שנבחר, ומוודא שעד להגדרת חיבור תקין רק מסך ההגדרות נגיש לצורך השלמת אשף ההתקנה.

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

### תהליך הצטרפות לארגון

1. התחבר באמצעות Supabase Auth (Google, Microsoft או אימייל+סיסמה).
2. מסך **בחירת ארגון** מציג את החברויות הקיימות. צור ארגון חדש או אשר הזמנה פתוחה כדי להמשיך.
3. לאחר בחירת ארגון פתח את **הגדרות → אשף הגדרה** לשמירת כתובת ה-Supabase והמפתח הציבורי ולהרצת ה-SQL המונחה.
4. מנהלים יכולים להזמין חברים נוספים מתוך **הגדרות → חברי ארגון**; המשתמש המוזמן יאשר את ההזמנה במסך בחירת הארגון ויקבל את אותו חיבור.

### בסיס אבטחת Supabase (Row Level Security)

כל פרויקט לקוח חייב להפעיל Row Level Security (RLS) כדי שרק משתמשים מאומתים יוכלו לקרוא או לעדכן נתונים. אשף ההגדרה שבאפליקציה (הגדרות → אשף הגדרה) מלווה את מנהל המערכת בשלושה צעדים מחייבים:

1. **חיבור** – הזינו את כתובת ה-URL הציבורית ואת מפתח ה-ANON של Supabase. הערכים נשמרים ברשומת הארגון (`app_organizations.supabase_url` / `supabase_anon_key`) יחד עם קישורי מדיניות והגדרות משפטיות כדי שכל המנהלים יעבדו מול אותה תצורה.
2. **החלת SQL** – הריצו את בלוק הסכימה ובלוק ה-RLS שלמטה (בסדר הזה) בעורך ה-SQL של Supabase בזמן שאתם מחוברים כבעלי הפרויקט.
3. **אימות** – לחצו על "הרץ אימות" באשף. הפונקציה `setup_assistant_diagnostics()` פועלת עם המפתח האנונימי, מדגישה רכיבים חסרים, ומעדכנת את `app_organizations.setup_completed` ו-`verified_at` כאשר כל הטבלאות והמדיניות מאובטחות. עד אז הניווט חסום למסכים אחרים פרט להגדרות.

#### SQL לסכימה ולעזר

```sql
-- שלב 1: יצירת סכימה מלאה ו-אובייקט עזר לאימות
set search_path = public;

create extension if not exists "pgcrypto";

create table if not exists public."Employees" (
  "id" uuid not null default gen_random_uuid(),
  "name" text not null,
  "employee_id" text not null,
  "employee_type" text,
  "current_rate" numeric,
  "phone" text,
  "email" text,
  "start_date" date,
  "is_active" boolean default true,
  "notes" text,
  "working_days" jsonb,
  "annual_leave_days" numeric default 12,
  "leave_pay_method" text,
  "leave_fixed_day_rate" numeric,
  "metadata" jsonb,
  constraint "Employees_pkey" primary key ("id")
);

create table if not exists public."Services" (
  "id" uuid not null default gen_random_uuid(),
  "name" text not null,
  "duration_minutes" bigint,
  "payment_model" text,
  "color" text,
  "metadata" jsonb,
  constraint "Services_pkey" primary key ("id")
);

create table if not exists public."RateHistory" (
  "id" uuid not null default gen_random_uuid(),
  "rate" numeric not null,
  "effective_date" date not null,
  "notes" text,
  "employee_id" uuid not null default gen_random_uuid(),
  "service_id" uuid default gen_random_uuid(),
  "metadata" jsonb,
  constraint "RateHistory_pkey" primary key ("id"),
  constraint "RateHistory_employee_id_fkey" foreign key ("employee_id") references public."Employees"("id"),
  constraint "RateHistory_service_id_fkey" foreign key ("service_id") references public."Services"("id")
);

create table if not exists public."WorkSessions" (
  "id" uuid not null default gen_random_uuid(),
  "employee_id" uuid not null default gen_random_uuid(),
  "service_id" uuid default gen_random_uuid(),
  "date" date not null,
  "session_type" text,
  "hours" numeric,
  "sessions_count" bigint,
  "students_count" bigint,
  "rate_used" numeric,
  "total_payment" numeric,
  "notes" text,
  "created_at" timestamptz default now(),
  "entry_type" text not null default 'hours',
  "payable" boolean,
  "metadata" jsonb,
  "deleted" boolean not null default false,
  "deleted_at" timestamptz,
  constraint "WorkSessions_pkey" primary key ("id"),
  constraint "WorkSessions_employee_id_fkey" foreign key ("employee_id") references public."Employees"("id"),
  constraint "WorkSessions_service_id_fkey" foreign key ("service_id") references public."Services"("id")
);

create table if not exists public."LeaveBalances" (
  "id" bigint generated always as identity primary key,
  "created_at" timestamptz not null default now(),
  "employee_id" uuid not null default gen_random_uuid(),
  "leave_type" text not null,
  "balance" numeric not null default 0,
  "effective_date" date not null,
  "notes" text,
  "metadata" jsonb,
  constraint "LeaveBalances_employee_id_fkey" foreign key ("employee_id") references public."Employees"("id")
);

create table if not exists public."Settings" (
  "id" uuid not null default gen_random_uuid(),
  "created_at" timestamptz not null default now(),
  "settings_value" jsonb not null,
  "updated_at" timestamptz default now(),
  "key" text not null unique,
  "metadata" jsonb,
  constraint "Settings_pkey" primary key ("id")
);

create index if not exists "RateHistory_employee_service_idx" on public."RateHistory" ("employee_id", "service_id", "effective_date");
create index if not exists "LeaveBalances_employee_date_idx" on public."LeaveBalances" ("employee_id", "effective_date");
create index if not exists "WorkSessions_employee_date_idx" on public."WorkSessions" ("employee_id", "date");
create index if not exists "WorkSessions_service_idx" on public."WorkSessions" ("service_id");
create index if not exists "WorkSessions_deleted_idx" on public."WorkSessions" ("deleted") where "deleted" = true;

create or replace function public.setup_assistant_diagnostics()
returns table (
  table_name text,
  has_table boolean,
  rls_enabled boolean,
  missing_policies text[],
  delta_sql text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  required_tables constant text[] := array['Employees', 'WorkSessions', 'LeaveBalances', 'RateHistory', 'Services', 'Settings'];
  required_policy_names text[];
  required_commands constant text[] := array['SELECT', 'INSERT', 'UPDATE', 'DELETE'];
  table_reg regclass;
  existing_policies text[];
  idx integer;
begin
  foreach table_name in array required_tables loop
    required_policy_names := array[
      format('Authenticated select %s', table_name),
      format('Authenticated insert %s', table_name),
      format('Authenticated update %s', table_name),
      format('Authenticated delete %s', table_name)
    ];

    table_reg := to_regclass(format('public.%I', table_name));
    has_table := table_reg is not null;
    rls_enabled := false;
    missing_policies := array[]::text[];
    delta_sql := '';

    if not has_table then
      missing_policies := required_policy_names;
      delta_sql := format('-- הטבלה "%s" חסרה. הרץ את בלוק הסכימה המלא.', table_name);
      return next;
      continue;
    end if;

    select coalesce(c.relrowsecurity, false)
      into rls_enabled
    from pg_class c
    where c.oid = table_reg;

    select coalesce(array_agg(policyname order by policyname), array[]::text[])
      into existing_policies
    from pg_policies
    where schemaname = 'public'
      and tablename = lower(table_name);

    missing_policies := array(
      select policy_name
      from unnest(required_policy_names) as policy_name
      where not (policy_name = any(existing_policies))
    );

    if not rls_enabled then
      delta_sql := delta_sql || format('ALTER TABLE public."%s" ENABLE ROW LEVEL SECURITY;', table_name) || E'\\n';
    end if;

    if array_length(missing_policies, 1) is null then
      missing_policies := array[]::text[];
    else
      for idx in 1..array_length(required_policy_names, 1) loop
        if array_position(missing_policies, required_policy_names[idx]) is not null then
          if required_commands[idx] = 'SELECT' then
            delta_sql := delta_sql || format(
              'CREATE POLICY "%s" ON public."%s"%s  FOR SELECT TO authenticated%s  USING (true);%s',
              required_policy_names[idx],
              table_name,
              E'\\n',
              E'\\n',
              E'\\n'
            );
          elsif required_commands[idx] = 'INSERT' then
            delta_sql := delta_sql || format(
              'CREATE POLICY "%s" ON public."%s"%s  FOR INSERT TO authenticated%s  WITH CHECK (true);%s',
              required_policy_names[idx],
              table_name,
              E'\\n',
              E'\\n',
              E'\\n'
            );
          elsif required_commands[idx] = 'UPDATE' then
            delta_sql := delta_sql || format(
              'CREATE POLICY "%s" ON public."%s"%s  FOR UPDATE TO authenticated%s  USING (true)%s  WITH CHECK (true);%s',
              required_policy_names[idx],
              table_name,
              E'\\n',
              E'\\n',
              E'\\n',
              E'\\n'
            );
          elsif required_commands[idx] = 'DELETE' then
            delta_sql := delta_sql || format(
              'CREATE POLICY "%s" ON public."%s"%s  FOR DELETE TO authenticated%s  USING (true);%s',
              required_policy_names[idx],
              table_name,
              E'\\n',
              E'\\n',
              E'\\n'
            );
          end if;
        end if;
      end loop;
    end if;

    if delta_sql = '' then
      delta_sql := null;
    end if;

    return next;
  end loop;

  return;
end;
$$;

grant execute on function public.setup_assistant_diagnostics() to authenticated;
```

#### SQL למדיניות RLS

```sql
-- שלב 2: הפעלת RLS והוספת מדיניות מאובטחת
alter table public."Employees" enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'Employees'
      and policyname = 'Authenticated select Employees'
  ) then
    create policy "Authenticated select Employees" on public."Employees"
      for select to authenticated
      using (true);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'Employees'
      and policyname = 'Authenticated insert Employees'
  ) then
    create policy "Authenticated insert Employees" on public."Employees"
      for insert to authenticated
      with check (true);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'Employees'
      and policyname = 'Authenticated update Employees'
  ) then
    create policy "Authenticated update Employees" on public."Employees"
      for update to authenticated
      using (true)
      with check (true);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'Employees'
      and policyname = 'Authenticated delete Employees'
  ) then
    create policy "Authenticated delete Employees" on public."Employees"
      for delete to authenticated
      using (true);
  end if;
end;
$$;

alter table public."WorkSessions" enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'WorkSessions'
      and policyname = 'Authenticated select WorkSessions'
  ) then
    create policy "Authenticated select WorkSessions" on public."WorkSessions"
      for select to authenticated
      using (true);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'WorkSessions'
      and policyname = 'Authenticated insert WorkSessions'
  ) then
    create policy "Authenticated insert WorkSessions" on public."WorkSessions"
      for insert to authenticated
      with check (true);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'WorkSessions'
      and policyname = 'Authenticated update WorkSessions'
  ) then
    create policy "Authenticated update WorkSessions" on public."WorkSessions"
      for update to authenticated
      using (true)
      with check (true);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'WorkSessions'
      and policyname = 'Authenticated delete WorkSessions'
  ) then
    create policy "Authenticated delete WorkSessions" on public."WorkSessions"
      for delete to authenticated
      using (true);
  end if;
end;
$$;

alter table public."LeaveBalances" enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'LeaveBalances'
      and policyname = 'Authenticated select LeaveBalances'
  ) then
    create policy "Authenticated select LeaveBalances" on public."LeaveBalances"
      for select to authenticated
      using (true);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'LeaveBalances'
      and policyname = 'Authenticated insert LeaveBalances'
  ) then
    create policy "Authenticated insert LeaveBalances" on public."LeaveBalances"
      for insert to authenticated
      with check (true);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'LeaveBalances'
      and policyname = 'Authenticated update LeaveBalances'
  ) then
    create policy "Authenticated update LeaveBalances" on public."LeaveBalances"
      for update to authenticated
      using (true)
      with check (true);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'LeaveBalances'
      and policyname = 'Authenticated delete LeaveBalances'
  ) then
    create policy "Authenticated delete LeaveBalances" on public."LeaveBalances"
      for delete to authenticated
      using (true);
  end if;
end;
$$;

alter table public."RateHistory" enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'RateHistory'
      and policyname = 'Authenticated select RateHistory'
  ) then
    create policy "Authenticated select RateHistory" on public."RateHistory"
      for select to authenticated
      using (true);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'RateHistory'
      and policyname = 'Authenticated insert RateHistory'
  ) then
    create policy "Authenticated insert RateHistory" on public."RateHistory"
      for insert to authenticated
      with check (true);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'RateHistory'
      and policyname = 'Authenticated update RateHistory'
  ) then
    create policy "Authenticated update RateHistory" on public."RateHistory"
      for update to authenticated
      using (true)
      with check (true);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'RateHistory'
      and policyname = 'Authenticated delete RateHistory'
  ) then
    create policy "Authenticated delete RateHistory" on public."RateHistory"
      for delete to authenticated
      using (true);
  end if;
end;
$$;

alter table public."Services" enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'Services'
      and policyname = 'Authenticated select Services'
  ) then
    create policy "Authenticated select Services" on public."Services"
      for select to authenticated
      using (true);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'Services'
      and policyname = 'Authenticated insert Services'
  ) then
    create policy "Authenticated insert Services" on public."Services"
      for insert to authenticated
      with check (true);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'Services'
      and policyname = 'Authenticated update Services'
  ) then
    create policy "Authenticated update Services" on public."Services"
      for update to authenticated
      using (true)
      with check (true);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'Services'
      and policyname = 'Authenticated delete Services'
  ) then
    create policy "Authenticated delete Services" on public."Services"
      for delete to authenticated
      using (true);
  end if;
end;
$$;

alter table public."Settings" enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'Settings'
      and policyname = 'Authenticated select Settings'
  ) then
    create policy "Authenticated select Settings" on public."Settings"
      for select to authenticated
      using (true);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'Settings'
      and policyname = 'Authenticated insert Settings'
  ) then
    create policy "Authenticated insert Settings" on public."Settings"
      for insert to authenticated
      with check (true);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'Settings'
      and policyname = 'Authenticated update Settings'
  ) then
    create policy "Authenticated update Settings" on public."Settings"
      for update to authenticated
      using (true)
      with check (true);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'Settings'
      and policyname = 'Authenticated delete Settings'
  ) then
    create policy "Authenticated delete Settings" on public."Settings"
      for delete to authenticated
      using (true);
  end if;
end;
$$;
```

#### אימות

- `setup_assistant_diagnostics()` מחזירה שורה לכל טבלה עם `has_table`, `rls_enabled`, `missing_policies[]` וקטע `delta_sql` שתוכלו להעתיק חזרה ל-SQL במידה שחסר משהו.
- האשף מציג את ה-`delta_sql` ומריץ את הבדיקות מחדש בכל לחיצה על כפתור האימות עד שכל הסמלים הופכים לירוקים.
4.  **הכן קובץ תצורה להרצה:**
    *   העתק את `public/runtime-config.example.json` אל `public/runtime-config.json`.
    *   מלא בקובץ את כתובת ה-Supabase ומפתח ה-anon של פרויקט המטא-דאטה של האפליקציה.
    *   הקובץ מופיע ב-`.gitignore`, ולכן האישורים נשארים מחוץ למאגר ולבילד.
5.  **הגדר פונקציית Azure (לבדיקות מקומיות):**
    *   צור את `api/local.settings.json` עם התוכן הבא:
        ----------------------------------------------------------------
        {
          "IsEncrypted": false,
          "Values": {
            "APP_SUPABASE_URL": "https://<metadata-project>.supabase.co",
            "APP_SUPABASE_SERVICE_ROLE": "service-role-key-with-org-access"
          }
        }
        ----------------------------------------------------------------
    *   הערכים הללו משרתים רק את פונקציית `/api/config` לאימות חברות ואסור לרשום אותם ללוגים.
6.  **הרץ את אפליקציית הפיתוח:**
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

