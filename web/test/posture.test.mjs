import {test} from 'node:test';
import assert from 'node:assert/strict';
import {patchPosture} from '../src/posture.ts';
import {backupEvidence} from '../src/backup-evidence.ts';
test('zero updates require recent evidence and an approved supported identity',()=>{
 const device={approved:true,platform:'windows',online:true,telemetry:{capabilities:{managed_operations:true}}};
 assert.equal(patchPosture(device,{scanned:1,report:{total:0}},100000).state,'Stale scan');
 assert.equal(patchPosture(device,{scanned:99999,report:{total:0}},100000).state,'Current');
 assert.equal(patchPosture({...device,approved:false},{scanned:99999,report:{total:0}},100000).state,'Ineligible');
 assert.equal(patchPosture({...device,telemetry:{}},undefined,100000).state,'Unsupported');
 assert.equal(patchPosture({...device,online:false},undefined,100000).eligible,false);
});
test('backup summary uses the same successful jobs and verification evidence as history',()=>{
 const sections={backup:{data:{rows:[{status:'failed',ended_at:200},{status:'completed',ended_at:100}]}},snapshot:{data:{rows:[{backup_ended_at:90,verify_fs_status:'passed'},{backup_ended_at:110,verify_fs_status:'failed'}]}}};
 const result=backupEvidence(sections,{},300);
 assert.equal(result.successful,100);assert.equal(result.latestPoint,110);assert.equal(result.verified,90);assert.equal(result.failed,1);
 assert.equal(backupEvidence({},{}).latestPoint,null);
});
