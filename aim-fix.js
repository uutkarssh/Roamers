// Authoritative Hunter aim payload: the server validates the exact line when HUNT is pressed.
$('#fireBtn').onclick=()=>{
  if(soloMode){soloHunt();return}
  if(socket?.connected && role==='HUNTER' && phase==='hunting'){
    const len=Math.hypot(aim.x,aim.y)||1;
    socket.emit('player:eliminate',{aimX:aim.x/len,aimY:aim.y/len});
  }
};
