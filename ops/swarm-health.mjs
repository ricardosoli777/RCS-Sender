try{
  const responses=await Promise.all([
    fetch('http://127.0.0.1:3001/health/ready',{signal:AbortSignal.timeout(5000)}),
    fetch('http://127.0.0.1:3000/login',{signal:AbortSignal.timeout(5000),redirect:'manual'})
  ]);
  if(responses.some(response=>response.status>=400))process.exitCode=1;
}catch{process.exitCode=1;}
