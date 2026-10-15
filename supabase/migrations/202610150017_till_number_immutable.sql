-- Stage 1B: a till number is part of every invoice and credit-note number it issues, so it never changes once assigned.

create function public.prevent_till_number_change()
returns trigger language plpgsql set search_path = public
as $$
begin
  if new.till_number is distinct from old.till_number then
    raise exception using errcode = 'P0001', message = 'till_number_immutable';
  end if;
  return new;
end
$$;

create trigger prevent_till_number_change before update on public.devices for each row execute function public.prevent_till_number_change();
