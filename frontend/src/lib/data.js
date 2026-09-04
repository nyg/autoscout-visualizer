import postgres from 'postgres'

const pgSql = postgres(process.env.PGSQL_URL, { prepare: false })

export async function fetchSearches() {
   return pgSql`
      select s.*,
             (select count(*)::int from search_runs where search_id = s.id) as run_count,
             (select count(*)::int from cars where search_id = s.id) as car_count,
             (select count(distinct c.screenshot_id) filter (where c.screenshot_id is not null)::int
                from cars c where c.search_id = s.id) as screenshot_count,
             (select coalesce(sum(sc.compressed_size), 0)::bigint
                from screenshots sc
               inner join cars c on c.screenshot_id = sc.id
               where c.search_id = s.id) as screenshot_size,
             (select count(distinct cp.photo_id)::int
                from car_photos cp
               inner join cars c on cp.car_id = c.id
               where c.search_id = s.id) as photo_count,
             (select coalesce(sum(p.compressed_size), 0)::bigint
                from photos p
               where p.id in (
                  select distinct cp.photo_id
                    from car_photos cp
                   inner join cars c on cp.car_id = c.id
                   where c.search_id = s.id
               )) as photo_size
        from searches s
       order by name`
}

export async function fetchSearchNames() {
   return pgSql`select id, name from searches order by name`
}

export async function fetchConfig() {
   try {
      const rows = await pgSql`select key, value from config`
      return Object.fromEntries(rows.map(r => [r.key, r.value]))
   } catch {
      return {}
   }
}

export async function fetchActiveListings(searchName) {
   return pgSql`
      select c.id, c.search_id, c.url, c.date_in, c.title, c.subtitle, c.description,
             c.vehicle_id, c.seller_vehicle_id, c.certification_number, c.price, c.body_type,
             c.color, c.mileage, c.has_additional_set_of_tires, c.had_accident, c.fuel_type,
             c.kilo_watts, c.cm3, c.cylinders, c.cylinder_layout, c.avg_consumption, c.co2_emission,
             c.warranty, c.leasing, c.created_date, c.last_modified_date, c.first_registration_date,
             c.last_inspection_date, c.seller_id, c.search_run_id,
             se.type seller_type, se.name seller_name, se.address seller_address, se.zip_code, se.city,
             365.25 * mileage / extract(day from current_timestamp - c.first_registration_date) as km_year,
             sc.r2_url as screenshot_url,
             (select count(*)::int from car_photos cp where cp.car_id = c.id) as photo_count
        from cars c
       inner join sellers se on c.seller_id = se.id
       inner join searches s on c.search_id = s.id
        left join screenshots sc on c.screenshot_id = sc.id
       where c.search_run_id = (
          select max(c2.search_run_id)
            from cars c2
           inner join searches s2 on c2.search_id = s2.id
           where s2.name = ${searchName}
       )
       order by c.price`
}

export async function fetchPreviousListings(searchName) {
   return pgSql`
      with latest_run as (
         select max(c2.search_run_id) search_run_id
           from cars c2
          inner join searches s2 on c2.search_id = s2.id
          where s2.name = ${searchName}
      )
      select * from (
         select distinct on (c.vehicle_id)
                c.id, c.search_id, c.url, c.date_in, c.title, c.subtitle, c.description,
                c.vehicle_id, c.seller_vehicle_id, c.certification_number, c.price, c.body_type,
                c.color, c.mileage, c.has_additional_set_of_tires, c.had_accident, c.fuel_type,
                c.kilo_watts, c.cm3, c.cylinders, c.cylinder_layout, c.avg_consumption, c.co2_emission,
                c.warranty, c.leasing, c.created_date, c.last_modified_date, c.first_registration_date,
                c.last_inspection_date, c.seller_id, c.search_run_id,
                se.type seller_type, se.name seller_name, se.address seller_address, se.zip_code, se.city,
                365.25 * mileage / extract(day from current_timestamp - c.first_registration_date) as km_year,
                sc.r2_url as screenshot_url,
                (select count(*)::int from car_photos cp where cp.car_id = c.id) as photo_count
           from cars c
          inner join sellers se on c.seller_id = se.id
          inner join searches s on c.search_id = s.id
           left join screenshots sc on c.screenshot_id = sc.id
          where s.name = ${searchName}
            and not exists (
                select 1 from cars l
                 inner join searches ls on l.search_id = ls.id
                 where ls.name = ${searchName}
                   and l.search_run_id = (select search_run_id from latest_run)
                   and l.vehicle_id = c.vehicle_id
            )
          order by c.vehicle_id, c.search_run_id desc
      ) as prev
      order by price`
}

export async function fetchSearchRuns(searchName, page = 1, pageSize = 20, fromDate, toDate) {
   const conditions = []
   if (searchName) {
      conditions.push(pgSql`s.name = ${searchName}`)
   }
   if (fromDate) {
      conditions.push(pgSql`sr.started_at >= ${fromDate}`)
   }
   if (toDate) {
      conditions.push(pgSql`sr.started_at < ${toDate}::date + interval '1 day'`)
   }
   const where = conditions.length > 0
      ? pgSql`where ${conditions.reduce((a, b) => pgSql`${a} and ${b}`)}`
      : pgSql``
   const offset = (page - 1) * pageSize
   return pgSql`
      select sr.id, s.name search_name,
             sr.started_at, sr.finished_at,
             sr.finish_reason, sr.success,
             sr.cars_found, sr.cars_scraped,
             sr.request_count, sr.failed_request_count,
             sr.stats
        from search_runs sr
       inner join searches s on sr.search_id = s.id
       ${where}
       order by sr.started_at desc
       limit ${pageSize} offset ${offset}`
}

export async function fetchSearchRunsCount(searchName, fromDate, toDate) {
   const conditions = []
   if (searchName) {
      conditions.push(pgSql`s.name = ${searchName}`)
   }
   if (fromDate) {
      conditions.push(pgSql`sr.started_at >= ${fromDate}`)
   }
   if (toDate) {
      conditions.push(pgSql`sr.started_at < ${toDate}::date + interval '1 day'`)
   }
   const where = conditions.length > 0
      ? pgSql`where ${conditions.reduce((a, b) => pgSql`${a} and ${b}`)}`
      : pgSql``
   const [row] = await pgSql`
      select count(*)::int as total
        from search_runs sr
       inner join searches s on sr.search_id = s.id
       ${where}`
   return row.total
}

export async function fetchDailyListingCount(searchName) {
   return pgSql`
      select extract(epoch from date_trunc('day', date_in))::bigint * 1000 date,
             count(*)::int car_count,
             avg(price) price_avg,
             avg(mileage) mileage_avg
        from cars c
       inner join searches s on c.search_id = s.id
       where s.name = ${searchName}
       group by date
       order by date`
}

export async function fetchCarScreenshotUrl(carId) {
   const [row] = await pgSql`
      select sc.r2_url
        from cars c
        left join screenshots sc on c.screenshot_id = sc.id
       where c.id = ${carId}`
   return row?.r2_url ?? null
}

export async function fetchCarPhotos(carId) {
   return pgSql`
      select p.r2_url
        from car_photos cp
       inner join photos p on cp.photo_id = p.id
       where cp.car_id = ${carId}
       order by cp.position`
}

export async function fetchVehicleScreenshots(vehicleId, searchId) {
   return pgSql`
      select sc.r2_url as url, sc.created_at as date
        from cars c
        join screenshots sc on c.screenshot_id = sc.id
       where c.vehicle_id = ${vehicleId}
         and c.search_id = ${searchId}
         and c.screenshot_id is not null
       order by sc.created_at asc`
}

export async function fetchStoredImages(graceHours) {
   const [screenshots, photos] = await Promise.all([
      pgSql`
         select s.id, s.r2_key, coalesce(s.compressed_size, 0) as size,
                exists (select 1 from cars c where c.screenshot_id = s.id) as referenced,
                s.created_at < current_timestamp - make_interval(hours => ${graceHours}::int) as past_grace
           from screenshots s`,
      pgSql`
         select p.id, p.r2_key, coalesce(p.compressed_size, 0) as size,
                exists (select 1 from car_photos cp where cp.photo_id = p.id) as referenced,
                p.created_at < current_timestamp - make_interval(hours => ${graceHours}::int) as past_grace
           from photos p`,
   ])
   return { screenshots, photos }
}

export async function fetchScreenshotStorageByDay() {
   return pgSql`
      select date_trunc('day', sc.created_at) as date,
             count(*)::int as count,
             sum(sc.compressed_size)::bigint as total_size
        from screenshots sc
       group by date
       order by date`
}

export async function fetchPriceChangedListings(searchName) {
   return pgSql`
      with latest_run as (
         select max(c2.search_run_id) as id
           from cars c2
          inner join searches s2 on c2.search_id = s2.id
          where s2.name = ${searchName}
      ),
      ordered_prices as (
         select c.vehicle_id, c.price, c.search_run_id, sr.started_at,
                lag(c.price) over (partition by c.vehicle_id order by c.search_run_id) as prev_price
           from cars c
          inner join searches s on c.search_id = s.id
          inner join search_runs sr on c.search_run_id = sr.id
          where s.name = ${searchName}
            and c.price is not null
      ),
      changed_vehicles as (
         select distinct vehicle_id
           from ordered_prices
          where prev_price is not null and price != prev_price
      ),
      price_change_entries as (
         select vehicle_id, price, started_at
           from ordered_prices
          where vehicle_id in (select vehicle_id from changed_vehicles)
            and (prev_price is null or price != prev_price)
      ),
      price_history_agg as (
         select vehicle_id,
                json_agg(json_build_object('price', price, 'date', started_at) order by started_at asc) as price_history,
                max(started_at) as last_change_date
           from price_change_entries
          group by vehicle_id
      ),
      latest_car as (
         select distinct on (c.vehicle_id)
                c.id, c.search_id, c.url, c.title, c.price, c.vehicle_id,
                c.mileage, c.first_registration_date, c.created_date,
                se.type seller_type, se.name seller_name, se.zip_code, se.city,
                exists(
                   select 1 from cars ac
                    where ac.vehicle_id = c.vehicle_id
                      and ac.search_run_id = (select id from latest_run)
                ) as is_active
           from cars c
          inner join searches s on c.search_id = s.id
          inner join sellers se on c.seller_id = se.id
          where s.name = ${searchName}
            and c.vehicle_id in (select vehicle_id from changed_vehicles)
            and c.price is not null
          order by c.vehicle_id, c.search_run_id desc
      )
      select lc.*,
             ph.price_history,
             ph.last_change_date,
             (ph.price_history->0->>'price')::int as first_price
        from latest_car lc
        join price_history_agg ph on lc.vehicle_id = ph.vehicle_id
       order by ph.last_change_date desc`
}

export async function fetchScreenshotStorageSummary() {
   const [row] = await pgSql`
      select count(*)::int as total_count,
             coalesce(sum(compressed_size), 0)::bigint as total_size
        from screenshots`
   return row
}
