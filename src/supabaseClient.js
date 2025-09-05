import { createClient } from '@supabase/supabase-js'

// החלף את הערכים הבאים בערכים האמיתיים שלך מהפרויקט ב-Supabase
const supabaseUrl = 'https://xmdxnbphujsqjntznwls.supabase.co' 
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhtZHhuYnBodWpzcWpudHpud2xzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTY5OTE1NDgsImV4cCI6MjA3MjU2NzU0OH0.QRR5isZCQCpouTyZ8hwftq-wSRMdeGrnbcMqwgm4uIk'

export const supabase = createClient(supabaseUrl, supabaseKey)