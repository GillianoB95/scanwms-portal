import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://zsjvmiyqhyzjeuyzovqx.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpzanZtaXlxaHl6amV1eXpvdnF4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQxMjgxNTMsImV4cCI6MjA4OTcwNDE1M30.EmsLdJtSwROqTnzKJOANY6Q5uPer7w5aJnlspnQNBB8';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
