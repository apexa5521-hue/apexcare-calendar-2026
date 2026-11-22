import test from 'node:test';
import assert from 'node:assert/strict';
import '../calendar-notification-state.js';
const {version,change}=globalThis.CalendarNotificationState;
const user={id:'ceo-id',name:'Dr.Anas'};
test('new work from another employee notifies but own work does not',()=>{assert.equal(change({id:'a',author_name:'Ruba'},null,user),'new');assert.equal(change({id:'b',author_user_id:user.id},null,user),null)});
test('opening a note as read is not a new activity notification',()=>{assert.equal(change({status:'read'},version({status:'new'}),user),null)});
test('new replies notify recipients and suppress the author',()=>{const n={replies:[{author_name:'Ruba',ts:'2027-01-01'}]};assert.equal(change(n,version({replies:[]}),user),'reply');assert.equal(change(n,version({replies:[]}),{id:'ruba',name:'Ruba'}),null)});
test('status updates notify once and archived work stays quiet',()=>{const n={status:'done',status_by:'Ruba'};assert.equal(change(n,version({status:'read'}),user),'status');assert.equal(change(n,version(n),user),null);assert.equal(change({...n,archived:true},version({status:'new'}),user),null)});
