-- Ark-1 pontoon trigger (ArduPilot Copter 4.5+ Lua, runs on the Pixhawk 6X)
--
-- Arms the inflatable pontoons for a planned water landing (PONT_PLAN_WTR = 1 and the vehicle is landing)
-- or an emergency ditching (battery failsafe while the companion says "over water", or the flag is stale).
-- Fires both CO2 inflators during the descent at a radar height that leaves time for full inflation,
-- confirms each side with its pressure switch, retries a side once, aborts a planned landing on failure,
-- and latches PONT_FIRED so it can never fire twice. See ../README.md for the full sequence.
--
-- Outputs: relay ARM (high side, shared) + relay FIRE_L / FIRE_R (low side, per side): a side fires only
-- when both its relay and ARM are on. Inputs: pressure switch per side on a GPIO, closed (= low) at 12 kPa.
--
-- shortcut: the companion's water flag arrives as a param write (PONT_OVERWTR + PONT_WTR_SEQ), upgrade to a
--   mavlink:register_rx_msgid NAMED_VALUE_INT reader if param writes prove too slow.
-- shortcut: no solenoid continuity check; add a sense resistor + ADC read when the driver board is laid out.

local TABLE_KEY, PREFIX = 47, 'PONT_'
assert(param:add_table(TABLE_KEY, PREFIX, 20), 'PONT: could not add param table')
local function p(name, idx, default)
  assert(param:add_param(TABLE_KEY, idx, name, default), 'PONT: could not add ' .. name)
  return Parameter(PREFIX .. name)
end

local ENABLE    = p('ENABLE', 1, 1)
local PLAN_WTR  = p('PLAN_WTR', 2, 0)     -- set by the mission planner (Ark Brain) for a planned water landing
local OVERWTR   = p('OVERWTR', 3, 0)      -- companion water classifier: 1 = water under the drone
local WTR_SEQ   = p('WTR_SEQ', 4, 0)      -- companion bumps this with every OVERWTR update (staleness check)
local FIRE_ALT  = p('FIRE_ALT', 5, 6.0)   -- m, minimum firing height (skid to water)
local INF_T     = p('INF_T', 6, 6.0)      -- s, fire to pressure-OK, cold case (pontoon_system.json)
local MARGIN    = p('MARGIN', 7, 1.5)
local ABORT_ALT = p('ABORT_ALT', 8, 1.5)  -- m, lowest height at which a planned landing is still aborted
local OK_TMO    = p('OK_TMO', 9, 11.9)    -- s, give up waiting for pressure
local RETRY_T   = p('RETRY_T', 10, 7.0)   -- s, re-pulse a side with no pressure yet
local RNG_OFS   = p('RNG_OFS', 11, 0.34)  -- m, radar face to skid bottom
local PULSE_MS  = p('PULSE_MS', 12, 300)
local FIRED     = p('FIRED', 13, 0)       -- latch, saved: ground crew clears it after re-arming the kit
local PS_L_PIN  = p('PS_L_PIN', 14, 55)
local PS_R_PIN  = p('PS_R_PIN', 15, 56)
local RLY_ARM   = p('RLY_ARM', 16, 0)
local RLY_L     = p('RLY_L', 17, 1)
local RLY_R     = p('RLY_R', 18, 2)

local MODE_AUTO, MODE_LOITER, MODE_LAND = 3, 5, 9
local NAV_LAND = 21
local ROT_DOWN = 25          -- ROTATION_PITCH_270
local RNG_GOOD = 4
local SEV_EMERG, SEV_CRIT, SEV_WARN, SEV_INFO = 0, 2, 4, 6
local WATER_STALE_MS = 5000

local IDLE, ARMED, FIRING, CONFIRM, DONE, FAILED = 0, 1, 2, 3, 4, 5
local state, why = IDLE, ''
local t_fire, t_pulse_off, pulse_sides = 0, 0, {}
local retried, holding, ok = false, false, { L = false, R = false }
local seq_seen, seq_ms = -1, 0
local auth_id = arming:get_aux_auth_id()

local function now() return millis():tofloat() end
local function say(sev, msg) gcs:send_text(sev, 'PONT: ' .. msg) end

local function pressure_ok(pin)
  return gpio:read(math.floor(pin:get())) == false   -- switch closes to GND
end

local function height()
  -- skid height above the water from the radar; terrain/EKF height as a fallback
  if rangefinder:has_data_orient(ROT_DOWN) and rangefinder:status_orient(ROT_DOWN) == RNG_GOOD then
    return rangefinder:distance_cm_orient(ROT_DOWN) / 100 - RNG_OFS:get(), 'radar'
  end
  local hagl = ahrs:get_hagl()
  if hagl then return hagl, 'hagl' end
  return nil, 'none'
end

local function descent_rate()
  local v = ahrs:get_velocity_NED()
  return v and v:z() or 0       -- NED: positive = going down
end

local function water_flag(t)
  local seq = WTR_SEQ:get()
  if seq ~= seq_seen then seq_seen, seq_ms = seq, t end
  if t - seq_ms > WATER_STALE_MS then return nil end
  return OVERWTR:get() == 1
end

local function landing()
  local mode = vehicle:get_mode()
  return mode == MODE_LAND or (mode == MODE_AUTO and mission:get_current_nav_id() == NAV_LAND)
end

-- why the system should be armed right now ('' = not armed)
local function arm_reason(t)
  if ENABLE:get() ~= 1 or FIRED:get() ~= 0 then return '' end
  if not (arming:is_armed() and vehicle:get_likely_flying()) then return '' end
  if PLAN_WTR:get() == 1 and landing() then return 'planned water landing' end
  if battery:has_failsafed() then
    local wet = water_flag(t)
    if wet == nil then return 'battery failsafe, water flag stale' end
    if wet then return 'battery failsafe over water' end
  end
  return ''
end

local function fire(sides)
  relay:on(math.floor(RLY_ARM:get()))
  for _, s in ipairs(sides) do relay:on(math.floor((s == 'L' and RLY_L or RLY_R):get())) end
  pulse_sides, t_pulse_off = sides, now() + PULSE_MS:get()
end

local function pulse_end()
  for _, s in ipairs(pulse_sides) do relay:off(math.floor((s == 'L' and RLY_L or RLY_R):get())) end
  relay:off(math.floor(RLY_ARM:get()))
  pulse_sides = {}
end

local function missing()
  local m = {}
  if not ok.L then m[#m + 1] = 'L' end
  if not ok.R then m[#m + 1] = 'R' end
  return m
end

local function update()
  local t = now()
  if #pulse_sides > 0 and t >= t_pulse_off then pulse_end() end

  -- pre-arm: no take-off with a spent kit or a pressure switch already closed (bag out or wiring short)
  if auth_id then
    if FIRED:get() ~= 0 then arming:set_aux_auth_failed(auth_id, 'PONT: kit spent, re-arm and clear PONT_FIRED')
    elseif state == IDLE and (pressure_ok(PS_L_PIN) or pressure_ok(PS_R_PIN)) then
      arming:set_aux_auth_failed(auth_id, 'PONT: pressure switch closed on ground')
    else arming:set_aux_auth_passed(auth_id) end
  end

  local h, src = height()
  local vz = descent_rate()

  if state == IDLE or state == ARMED then
    local reason = arm_reason(t)
    if reason == '' then
      if state == ARMED then say(SEV_INFO, 'disarmed (' .. why .. ' ended)') end
      state = IDLE
    else
      if state == IDLE then say(SEV_WARN, 'ARMED: ' .. reason); why = reason end
      state = ARMED
      local fire_h = math.max(FIRE_ALT:get(), vz * INF_T:get() * MARGIN:get() + ABORT_ALT:get())
      if h and vz > 0.1 and h <= fire_h then
        FIRED:set_and_save(1)                    -- latch before the pulse: never fire twice
        fire({ 'L', 'R' })
        t_fire, retried, holding = t, false, false
        state = FIRING
        say(SEV_CRIT, string.format('FIRE at %.1f m (%s), %.1f m/s down', h, src, vz))
      end
    end
  elseif state == FIRING or state == CONFIRM then
    state = CONFIRM
    for _, s in ipairs({ 'L', 'R' }) do
      if not ok[s] and pressure_ok(s == 'L' and PS_L_PIN or PS_R_PIN) then
        ok[s] = true
        say(SEV_INFO, string.format('%s pressure OK at %.1f s', s, (t - t_fire) / 1000))
      end
    end
    local planned = PLAN_WTR:get() == 1
    local dt = (t - t_fire) / 1000
    if ok.L and ok.R then
      state = DONE
      if holding then vehicle:set_mode(MODE_LAND); say(SEV_WARN, 'both sides OK, landing resumed') end
    elseif not retried and dt >= RETRY_T:get() then
      local m = missing()
      retried = true
      fire(m)                                    -- one retry: the latch may have stuck, the cylinder is still full
      if planned and h and h > ABORT_ALT:get() then
        vehicle:set_mode(MODE_LOITER); holding = true
        say(SEV_CRIT, 'no pressure ' .. table.concat(m) .. ': holding, retry fired')
      else
        say(SEV_CRIT, 'no pressure ' .. table.concat(m) .. ': retry fired')
      end
    elseif dt >= math.max(OK_TMO:get(), RETRY_T:get() + INF_T:get()) then
      state = FAILED
      local m = table.concat(missing())
      if holding then
        say(SEV_EMERG, 'side ' .. m .. ' FAILED: water landing aborted, holding for divert')
      else
        say(SEV_EMERG, 'side ' .. m .. ' FAILED: landing anyway, expect a list')
      end
    end
  end

  if not arming:is_armed() then
    if #pulse_sides > 0 then pulse_end() end
    if state ~= IDLE then state = IDLE; ok = { L = false, R = false } end
  end

  logger:write('PONT', 'St,H,Vz,L,R', 'Bffbb', state, h or -1, vz, ok.L and 1 or 0, ok.R and 1 or 0)
  return update, 50
end

say(SEV_INFO, 'pontoon trigger loaded')
return update, 1000
