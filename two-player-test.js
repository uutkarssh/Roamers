const originalRenderPlayers=window.renderPlayers;
if(typeof originalRenderPlayers==='function'){
  window.renderPlayers=()=>{
    originalRenderPlayers();
    const hint=document.querySelector('#startHint');
    const count=window.players?.size??0;
    if(hint)hint.textContent=count<2?'Need at least 2 players to start.':`${count} players ready.`;
  };
}
