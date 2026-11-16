-- After 01_school.sql, edit the three values below and run in the SQL Editor.
-- Username must have 3–48 English letters, digits, dots, underscores or hyphens.
-- Use a strong password of at least 12 characters. Use the same username when logging in.
do $bootstrap$
declare
  admin_username text := 'school_admin';
  admin_password text := 'REPLACE_WITH_YOUR_OWN_SECRET';
  admin_name text := 'مدیر دبیرستان';
begin
  if admin_password = 'REPLACE_WITH_YOUR_OWN_SECRET' or length(admin_password) < 12 then
    raise exception 'Choose a new admin password of at least 12 characters.';
  end if;
  perform pg_advisory_xact_lock(hashtext('kh2_first_admin'));
  if exists (select 1 from public.kh2_people where role = 'admin') then
    raise exception 'The first administrator already exists.';
  end if;
  perform kh2_private.add_person(admin_username, admin_password, admin_name, 'admin');
end;
$bootstrap$;
