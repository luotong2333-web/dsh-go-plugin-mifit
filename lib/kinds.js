// Sport names for Xiaomi workout records.
//
// The service names every workout with a key on the record envelope (for
// example `elliptical_trainer`), which mifit leaves out of the records it
// exports. The sidecar copies those keys into `workout_kinds.json`; this table
// turns a key into a name a person reads. The numeric table is only a fallback
// for records written before that file existed, and lists just the codes
// confirmed on a real record — guessing there would mislabel a workout.

// key -> [中文, English]
const KINDS = {
  outdoor_walking: ['健走', 'Walking'],
  indoor_walking: ['室内步行', 'Indoor walking'],
  outdoor_hiking: ['户外徒步', 'Hiking'],
  outdoor_running: ['户外跑步', 'Outdoor running'],
  indoor_running: ['室内跑步', 'Indoor running'],
  treadmill: ['跑步机', 'Treadmill'],
  climbing: ['登山', 'Climbing'],
  mountaineering: ['登山', 'Mountaineering'],
  outdoor_riding: ['户外骑行', 'Outdoor cycling'],
  indoor_riding: ['室内单车', 'Indoor cycling'],
  indoor_cycling: ['室内单车', 'Indoor cycling'],
  spinning: ['动感单车', 'Spinning'],
  cross_hiking: ['越野', 'Trail hiking'],
  pool_swimming: ['泳池游泳', 'Pool swimming'],
  open_swimming: ['开放水域游泳', 'Open water swimming'],
  football: ['足球', 'Football'],
  basketball: ['篮球', 'Basketball'],
  volleyball: ['排球', 'Volleyball'],
  pingpong: ['乒乓球', 'Table tennis'],
  badminton: ['羽毛球', 'Badminton'],
  tennis: ['网球', 'Tennis'],
  golf: ['高尔夫', 'Golf'],
  snowboarding: ['单板滑雪', 'Snowboarding'],
  parallel_skiing: ['双板滑雪', 'Skiing'],
  skiing: ['滑雪', 'Skiing'],
  indoor_skating: ['室内滑冰', 'Indoor skating'],
  outdoor_skating: ['户外滑冰', 'Outdoor skating'],
  rowing_machine: ['划船机', 'Rowing machine'],
  rowing: ['划船', 'Rowing'],
  canoeing: ['皮划艇', 'Canoeing'],
  rope_skipping: ['跳绳', 'Jump rope'],
  jump_rope: ['跳绳', 'Jump rope'],
  triathlon: ['铁人三项', 'Triathlon'],
  free_training: ['自由活动', 'Freestyle'],
  high_interval_training: ['高强度间歇训练', 'HIIT'],
  strength_training: ['力量训练', 'Strength training'],
  core_training: ['核心训练', 'Core training'],
  yoga: ['瑜伽', 'Yoga'],
  pilates: ['普拉提', 'Pilates'],
  stretch: ['拉伸', 'Stretching'],
  boxing: ['拳击', 'Boxing'],
  taichi: ['太极', 'Tai chi'],
  taekwondo: ['跆拳道', 'Taekwondo'],
  dance: ['舞蹈', 'Dance'],
  zumba: ['尊巴', 'Zumba'],
  latin_dance: ['拉丁舞', 'Latin dance'],
  square_dance: ['广场舞', 'Square dance'],
  elliptical_trainer: ['椭圆机', 'Elliptical'],
  stair_climbing_machine: ['爬楼机', 'Stair climber'],
  stair_climber: ['爬楼机', 'Stair climber'],
  stepper: ['踏步机', 'Stepper'],
  hula_hoop: ['呼啦圈', 'Hula hoop'],
  battle_rope: ['战绳', 'Battle rope'],
  kettlebell: ['壶铃', 'Kettlebell'],
  aerobics: ['有氧操', 'Aerobics'],
  ice_hockey: ['冰球', 'Ice hockey'],
  archery: ['射箭', 'Archery'],
  fishing: ['钓鱼', 'Fishing'],
  horse_riding: ['骑马', 'Horse riding'],
}

// sport_type number -> key. Only the codes seen on a real record are listed;
// mifit's own table covers the same four, plus 11 confirmed here.
const CODE_KEYS = {
  1: 'outdoor_running',
  6: 'outdoor_riding',
  11: 'elliptical_trainer',
  300: 'stair_climbing_machine',
  308: 'strength_training',
}

function keyFor(record, stored) {
  const stamp = record?.start_epoch_s
  const kinds = stored?.kinds
  if (stamp != null && kinds && typeof kinds === 'object') {
    const key = kinds[String(stamp)]
    if (typeof key === 'string' && key !== '') return key
  }
  const code = record?.source_sport_code
  if (typeof code === 'number' && CODE_KEYS[code]) return CODE_KEYS[code]
  return ''
}

function spelledOut(key) {
  return String(key)
    .split('_')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

// The workout's sport as a name. Falls back to the bare number, then to a word,
// so a table that never met this workout still reads as a sentence.
export function kindLabel(record, stored, locale) {
  const en = String(locale ?? '').startsWith('en')
  const key = keyFor(record, stored)
  if (key !== '') {
    const names = KINDS[key]
    if (names) return en ? names[1] : names[0]
    return spelledOut(key)
  }
  const code = record?.source_sport_code
  if (typeof code === 'number' && Number.isFinite(code)) {
    return en ? `Sport #${code}` : `运动 #${code}`
  }
  return en ? 'Workout' : '运动'
}
