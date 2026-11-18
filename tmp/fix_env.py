import sys
p='src/infra/environment.ts'
s=open(p,encoding='utf-8').read()
marker='<<<<<<< HEAD\n    // A local installation names no GitHub CLI'
start=s.index(marker)
endtok='>>>>>>> agent/desktop-client-support-550746ace325'
end=s.index(endtok,start)+len(endtok)+1
bt=chr(96)
new='    // A local installation names no GitHub CLI, so its git gets no GitHub credential helper and no URL rewrite.\n'
new+='    ...github.cli ? [\n'
new+="      '[credential \"https://github.com\"]', "+bt+'\\thelper = ${gitQuote(credentialHelper(github.cli, platform))}'+bt+',\n'
new+="      '[url \"https://github.com/\"]', '\\tinsteadOf = git@github.com:', '\\tinsteadOf = ssh://git@github.com/',\n"
new+='    ] : [],\n'
s=s[:start]+new+s[end:]
open(p,'w',encoding='utf-8').write(s)
print('ok')