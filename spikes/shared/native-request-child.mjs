const [base,path,body,actor] = process.argv.slice(2);
process.send({ phase:'ready',pid:process.pid });
process.once('message',async () => {
  try {
    const response=await fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json','x-poc-session':`test-session:${actor}`},body,signal:AbortSignal.timeout(15000)});
    process.send({phase:'result',pid:process.pid,status:response.status,body:await response.json()});
  } catch(error) { process.send({phase:'result',pid:process.pid,error:error.message});process.exitCode=1; }
  process.disconnect();
});
