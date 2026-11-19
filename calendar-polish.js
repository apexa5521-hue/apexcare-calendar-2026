/* Keep labels and existing click handlers; icon loading failure is harmless. */
(function(){
 var icons={btnAddNote:'calendar-plus',btnInbox:'inbox',btnAlerts:'bell',btnArchive:'archive',btnReport:'chart-no-axes-combined',btnEditLog:'history'};
 if(window.lucide){Object.keys(icons).forEach(function(id){var button=document.getElementById(id);if(!button)return;var icon=document.createElement('i');icon.setAttribute('data-lucide',icons[id]);icon.className='apx-icon';icon.setAttribute('aria-hidden','true');button.prepend(icon);});window.lucide.createIcons();}
 var toast=document.getElementById('toast');if(toast){toast.setAttribute('role','status');toast.setAttribute('aria-live','polite');}
 function headerSize(){var header=document.querySelector('.topbar');if(header)document.documentElement.style.setProperty('--H',Math.max(58,header.offsetHeight)+'px');}
 window.addEventListener('resize',headerSize);headerSize();
})();
