(function(root){
'use strict';
function version(n){var replies=n.replies||[],edits=n.editLog||[];return {status:n.status||'new',statusTs:n.statusTs||'',replyCount:replies.length,replyTs:replies[replies.length-1]?.ts||'',editCount:edits.length,editTs:edits[edits.length-1]?.ts||'',activity:n.last_activity_at||'',archived:!!n.archived}}
function change(n,previous,user){if(n.archived)return null;var current=version(n),kind=null,actor=null;if(!previous){kind='new';actor=n.author_name||n.imported_by;if(n.author_user_id===user.id||n.imported_by===user.name)return null;}else if(current.replyCount>previous.replyCount||current.replyTs!==previous.replyTs){kind='reply';actor=(n.replies||[]).slice(-1)[0]?.author_name;}else if(current.status!==previous.status&&['done','rejected'].includes(current.status)){kind='status';actor=n.status_by;}else if(current.editCount>previous.editCount||current.editTs!==previous.editTs){kind='edit';actor=(n.editLog||[]).slice(-1)[0]?.by;}return kind&&actor!==user.name?kind:null;}
root.CalendarNotificationState={version:version,change:change};
})(typeof window!=='undefined'?window:globalThis);
