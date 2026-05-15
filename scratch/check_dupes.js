const data = `5690	04-04-2026	—	Refrigerated Display Cabinet -Commercial	42214260201523	Karthik	INSTALLATION CALL	—
1251	04-04-2026	—	Refrigerated Display Cabinet -Commercial	32568260201241	Suman	INSTALLATION CALL	—
5674	04-04-2026	—	Refrigerated Display Cabinet -Commercial	32568260201119	Karthik	INSTALLATION CALL	—
5655	04-04-2026	—	Refrigerated Display Cabinet -Commercial	42214260201936	Kumar	INSTALLATION CALL	—
5677	04-04-2026	—	Refrigerated Display Cabinet -Commercial	32534260201611	Karthik	INSTALLATION CALL	—
7703	04-04-2026	—	Refrigerated Display Cabinet -Commercial	32534260302301	Chandraprakash Singh	INSTALLATION CALL	—
5689	04-04-2026	—	Refrigerated Display Cabinet -Commercial	42214260201466	Kumar	INSTALLATION CALL	—
5688	04-04-2026	—	Refrigerated Display Cabinet -Commercial	42214260201510	Karthik	INSTALLATION CALL	—
5687	04-04-2026	—	Refrigerated Display Cabinet -Commercial	42214260201488	Karthik	INSTALLATION CALL	—
5686	04-04-2026	—	Refrigerated Display Cabinet -Commercial	42214260201502	Karthik	INSTALLATION CALL	—
5685	04-04-2026	—	Refrigerated Display Cabinet -Commercial	42214260201493	Karthik	INSTALLATION CALL	—
5684	04-04-2026	—	Refrigerated Display Cabinet -Commercial	32534260201564	Karthik	INSTALLATION CALL	—
5683	04-04-2026	—	Refrigerated Display Cabinet -Commercial	32534260201574	Karthik	INSTALLATION CALL	—
5682	04-04-2026	—	Refrigerated Display Cabinet -Commercial	32538250300053	Karthik	INSTALLATION CALL	—
5664	04-04-2026	—	Refrigerated Display Cabinet -Commercial	32534260201387	Karthik	INSTALLATION CALL	—
5662	04-04-2026	—	Refrigerated Display Cabinet -Commercial	32534260201386	Karthik	INSTALLATION CALL	—
5661	04-04-2026	—	Refrigerated Display Cabinet -Commercial	42214260201490	Kumar	INSTALLATION CALL	—
5654	04-04-2026	—	Refrigerated Display Cabinet -Commercial	42214260201492	Kumar	INSTALLATION CALL	—
5648	04-04-2026	—	Refrigerated Display Cabinet -Commercial	42214260201937	Bala	INSTALLATION CALL	—
5693	04-04-2026	—	Refrigerated Display Cabinet -Commercial	10258250300857	Karthik	INSTALLATION CALL	—
5692	04-04-2026	—	Refrigerated Display Cabinet -Commercial	32568260201129	Kumar	INSTALLATION CALL	—
5691	04-04-2026	—	Refrigerated Display Cabinet -Commercial	42214260201919	Karthik	INSTALLATION CALL	—
1250	04-04-2026	—	Refrigerated Display Cabinet -Commercial	32568260201240	Suman	INSTALLATION CALL	—
1249	04-04-2026	—	Refrigerated Display Cabinet -Commercial	32568260201237	Suman	INSTALLATION CALL	—
1253	04-04-2026	—	Refrigerated Display Cabinet -Commercial	32568260201307	Suman	INSTALLATION CALL	—
1252	04-04-2026	—	Refrigerated Display Cabinet -Commercial	32568260201242	Suman	INSTALLATION CALL	—
5673	04-04-2026	—	Refrigerated Display Cabinet -Commercial	32568260201146	Karthik	INSTALLATION CALL	—
5672	04-04-2026	—	Refrigerated Display Cabinet -Commercial	32568260201145	Karthik	INSTALLATION CALL	—
5671	04-04-2026	—	Refrigerated Display Cabinet -Commercial	32568260201154	Karthik	INSTALLATION CALL	—
5670	04-04-2026	—	Refrigerated Display Cabinet -Commercial	32568260201157	Karthik	INSTALLATION CALL	—
5669	04-04-2026	—	Refrigerated Display Cabinet -Commercial	32568260201256	Karthik	INSTALLATION CALL	—
5668	04-04-2026	—	Refrigerated Display Cabinet -Commercial	42214260201463	Karthik	INSTALLATION CALL	—
5667	04-04-2026	—	Refrigerated Display Cabinet -Commercial	42214260201494	Karthik	INSTALLATION CALL	—
5666	04-04-2026	—	Refrigerated Display Cabinet -Commercial	32568260201143	Karthik	INSTALLATION CALL	—
5665	04-04-2026	—	Refrigerated Display Cabinet -Commercial	32568260201149	Karthik	INSTALLATION CALL	—
5650	04-04-2026	—	Refrigerated Display Cabinet -Commercial	32536250900594	Bala	INSTALLATION CALL	—
5649	04-04-2026	—	Refrigerated Display Cabinet -Commercial	32536250900586	Bala	INSTALLATION CALL	—
5646	04-04-2026	—	Refrigerated Display Cabinet -Commercial	42214260201324	Bala	INSTALLATION CALL	—
5639	04-04-2026	—	Refrigerated Display Cabinet -Commercial	42214260201397	Bala	INSTALLATION CALL	—
5676	04-04-2026	—	Refrigerated Display Cabinet -Commercial	42214260201475	Karthik	INSTALLATION CALL	—
5675	04-04-2026	—	Refrigerated Display Cabinet -Commercial	32536250900587	Karthik	INSTALLATION CALL	—
5694	04-04-2026	—	Refrigerated Display Cabinet -Commercial	32536250900588	Karthik	INSTALLATION CALL	—
5681	04-04-2026	—	Refrigerated Display Cabinet -Commercial	32536250900593	Karthik	INSTALLATION CALL	—
5679	04-04-2026	—	Refrigerated Display Cabinet -Commercial	42214260201472	Karthik	INSTALLATION CALL	—
5678	04-04-2026	—	Refrigerated Display Cabinet -Commercial	32536250900590	Karthik	INSTALLATION CALL	—
7702	04-04-2026	—	Refrigerated Display Cabinet -Commercial	32537260200047	Rajiv Singh	INSTALLATION CALL	—`;

const lines = data.split('\n');
const refs = lines.map(l => l.split('\t')[0]);
const duplicates = refs.filter((item, index) => refs.indexOf(item) !== index);
console.log('Duplicates:', duplicates);
console.log('Total items:', refs.length);
console.log('Unique items:', new Set(refs).size);
