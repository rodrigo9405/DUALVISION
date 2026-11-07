-- DualVision: salas identificadas por código de 6 caracteres.
-- Ya aplicado en el proyecto DUALVISION. Para recrearlo: Supabase → SQL Editor → pegar y Run.
create table if not exists public.salas (
  codigo text primary key check (codigo ~ '^[A-Z2-9]{6}$'),
  creada_en timestamptz not null default now(),
  ultima_actividad timestamptz not null default now()
);

alter table public.salas enable row level security;
-- Sin políticas: nadie puede listar ni modificar la tabla directamente.

-- Crea una sala nueva y devuelve su código.
create or replace function public.crear_sala()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  alfabeto constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  nuevo text;
  intentos int := 0;
begin
  -- Limpieza: salas sin uso en 30 días.
  delete from public.salas where ultima_actividad < now() - interval '30 days';
  loop
    nuevo := '';
    for i in 1..6 loop
      nuevo := nuevo || substr(alfabeto, 1 + floor(random() * length(alfabeto))::int, 1);
    end loop;
    begin
      insert into public.salas(codigo) values (nuevo);
      return nuevo;
    exception when unique_violation then
      intentos := intentos + 1;
      if intentos > 10 then raise exception 'No se pudo crear la sala'; end if;
    end;
  end loop;
end;
$$;

-- Dice si una sala existe y marca actividad.
create or replace function public.entrar_sala(p_codigo text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  existe boolean;
begin
  update public.salas
     set ultima_actividad = now()
   where codigo = upper(trim(p_codigo))
  returning true into existe;
  return coalesce(existe, false);
end;
$$;

revoke all on function public.crear_sala() from public;
revoke all on function public.entrar_sala(text) from public;
grant execute on function public.crear_sala() to anon, authenticated;
grant execute on function public.entrar_sala(text) to anon, authenticated;
