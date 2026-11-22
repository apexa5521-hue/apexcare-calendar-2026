// Reading is automatic; execution status remains done/rejected until explicitly changed.
function markNoteReadOnOpen(note,viewer){
 if(!note||!viewer||note.from_role===viewer)return false;
 var addressed=note.to_role===viewer||note.to_role==='all';
 if(!addressed)return false;
 if(note.status&&note.status!=='new')return false;
 note.status='read';note.statusTs=new Date().toISOString();return true;
}
