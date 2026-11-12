import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import test from 'node:test';
import {thaiDate,thaiDateTime} from '../lib/format/date.ts';

test('server and browser timezones render the same Bangkok collection date and time',()=>{
  const code="import {thaiDate,thaiDateTime} from './lib/format/date.ts';const date='2026-11-11T20:30:00Z';console.log(JSON.stringify({day:thaiDate(date),time:thaiDateTime(date)}));";
  const results=['UTC','Asia/Bangkok','America/New_York'].map(TZ=>{
    const run=spawnSync(process.execPath,['--experimental-strip-types','--input-type=module','-e',code],{env:{...process.env,TZ},encoding:'utf8'});
    assert.equal(run.status,0,run.stderr);
    return JSON.parse(run.stdout);
  });
  assert.deepEqual(results[0],results[1],'UTC server markup must match the Bangkok browser');
  assert.deepEqual(results[1],results[2],'A travelling user still sees the company timezone');
  assert.equal(results[0].day,'12 พ.ย. 2569');
  assert.match(results[0].time,/03:30/);
});

test('absent and invalid dates remain unknown',()=>{
  for(const value of [null,undefined,'','invalid']){
    assert.equal(thaiDate(value),'—');
    assert.equal(thaiDateTime(value),'—');
  }
});
