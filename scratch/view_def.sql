CREATE VIEW [dbo].[uv_findtrhcalls_callsearch]        
AS            
SELECT c.ncode, c.ntrnno AS callsntrnno, c.dtrndate AS callsdtrndate,                                                                                                 
c.ncalltype AS callncalltype, dbo.mstitems.vitemcode AS itemcode, dbo.mstitems.vname AS itemname, dbo.mstusers.vname AS serviceman,                                                                                                 
c.vserialno AS callsvserialno, c.ddateofpurchase, soldby.vname AS soldby, c.vlocation, c.vcomplaint,                                                                                                 
CONVERT(NVARCHAR(12), c.dallocationdatetime, 113) AS dallocationdatetime, c.dapptdatetime, c.vmanualjobno,                                                                                                 
c.npendingreason AS callsnpendingreason, c.ncancelreason, c.bsolved AS callsolved,                                                                                                 
c.dsolvedatetime AS callsolveddate, c.vsolveremarks, c.bdelivered, c.bdelivered AS calldelivered,                                                                                                 
CASE WHEN c.bdelivered = 0 THEN 'No' ELSE 'Yes' END AS Delivered, c.vdeliveredto, c.ddeliveredon,                                                                                                 
c.nitemtotal, c.ndiscount, c.ntaxset, ISNULL(c.ntotalamount,0) AS ntotalamount, c.namountrecd, c.vtcrno,
c.vtcramt, c.dinvoicedt, c.nofficeid, c.addedby, c.addedon, c.editedby,                                                                                                 
c.editedon, c.ipaddress, c.nescalateto, c.nengineer, c.ncomplaint,                                                                                                 
c.vspecialinstructions, c.nsoldby, c.nitem, c.nitemserialno, c.vpersoncalling,                                                                                                 
c.npartycontact, c.nparty, c.vtrnprefix, dbo.mstparty.vname AS PartyName,                                                                                                 
dbo.mstfixedselection.vdisplayvalue AS calltype, c.vinvoiceprefix, c.ninvoiceno,                                                                                                 
c.vinvoiceprefix + CAST(c.ninvoiceno AS nvarchar(20)) AS vinvoiceno, dbo.mstcheckset.ncode AS checksetncode,                                                                                                 
dbo.mstcheckset.vname AS checksetvname, NULL AS Status, dbo.mstroute.vname AS Route, c.bapproval,                                                                           
c.vtrnno AS newtrnno,                                                                                                 
--c.dactivationdate, dbo.udf_getwcostatus(c.ncode, c.nofficeid) AS WCO, 
CASE
    WHEN pr.dwarrenddate IS NOT NULL
         AND pr.dwarrenddate >= CAST(c.dtrndate AS DATE)
         AND pr.bwvoid = 1
    THEN 'V'
    WHEN pr.dwarrenddate IS NOT NULL
         AND CAST(pr.dwarrenddate AS DATE) >= CAST(c.dtrndate AS DATE)
         AND CAST(pr.dwarrstartdate AS DATE) <= CAST(c.dtrndate AS DATE)
    THEN 'W'
    WHEN pr.dcontenddate IS NOT NULL
         AND CAST(pr.dcontenddate AS DATE) >= CAST(c.dtrndate AS DATE)
         AND CAST(pr.dcontstartdate AS DATE) <= CAST(c.dtrndate AS DATE)
    THEN 'AMC'
    ELSE 'O'
END AS WCO,
dbo.mstroute.ncode AS routencode,                                                                                                 
dbo.mstcity.ncode AS cityncode,
--, dbo.udf_getwcostatussearch(c.ncode, c.nofficeid) AS WCOSearch, 
CASE
    WHEN pr.dwarrenddate IS NOT NULL
         AND pr.dwarrenddate >= CAST(c.dtrndate AS DATE)
         AND pr.bwvoid = 1
    THEN '4'
    WHEN pr.dwarrenddate IS NOT NULL
         AND pr.dwarrenddate >= CAST(c.dtrndate AS DATE)
    THEN '1'
    WHEN pr.dcontenddate IS NOT NULL
         AND pr.dcontenddate >= CAST(c.dtrndate AS DATE)
    THEN '2'
    ELSE '3'
END AS WCOSearch,
faultAgg.ndefect, faultAgg.nrepair,                                   
visitAgg.dvisitdatetime, partsAgg.nitem AS parts,visitAgg.ntimespent,                                                    
spareitem.vname spareitemname,  spareitem.vitemcode spareitemcode, dbo.mstcallpendingreasons.vname AS Pending_Reason                                                                   
--Added by manoj28july15                                                                            
,mstparty.vlatlong,mstparty.vinstaddress                                                                       
--Added end by manoj28july15                                                                          
                                                      
----START ADDED BY MAYUR ON 07092015 FOR Standard UCN and CALL TRANSFER CHANGES                                                                           
,c.vtrnno AS  UniqueCallNo   ,                                                    
c.bfastclose,                                                                             
ISNULL(c.bfastclose,0) callfastclose,                                                                        
c.dfastclosedatetime                                                                       
----END ADDED BY MAYUR ON 07092015 FOR Standard UCN and CALL TRANSFER CHANGES                                                                      
 ,c.baccepted as accptstatus--Added by Arshad 19-09-2015                                                                      
 ,visitAgg.nvisitby --added by suresh on 19052016                                                                 
 ---START ADDED BY ANISH ON 06-JUNE-2017                                                                
 ,mstparty.vinsttel1 AS  vinsttel1,mstparty.vinsttel2 AS  vinsttel2 ,mstroute.vname as routeName                                                               
  ---END ADDED BY ANISH ON 06-JUNE-2017                                                                
  ,dbo.mstcity.vname AS vcity --ADDED BY ARSHAD 08012018                                                            
  ,c.npriority ,fixedselection_priority.vdisplayvalue as Priority    ------ADDED BY Pranjali 04-May-2017                                                   
   ,c.nautootp,c.nenteredOTP--Added by Pranjali on 02-July-2018                                             
   ,c.approvedby as STATUSBY,c.approvedon as STATUSON  ,c.vcomment 
   ,(select top 1 nitem from    trdcalls3parts where ncalls=c.ncode and nofficeid=c.nofficeid )as Item-- Added by Prasad on 12 July 2018                    

    
   ,CASE WHEN visitAgg.ncalls IS NULL THEN 'NO' else 'YES' end as visit--ADDED BY PRASAD ON 13052019                                          
   ,mstpartyprofile.vname as vcustprofile        --Added by Pranjali on 14052019                                         
   ,  c.dfastclosedatetime as callfastclosedate                                    
,case when c.bsolved=1 then 'Solved' else case when c.ncancelreason Is not null then 'Cancel' else case when c.bsolved=0 and c.ncancelreason IS null then 'Open' end end end as 'callstatus'                                   
,c.vrmainno1 as vrmainno1s                           
,mstoffice.vcompanyname as officename                       
,c.vcclid                     
,transferoffice.vcompanyname as vtransferofficename                    
,c.vtransfercallno                    
, c.dtransfertooffice as dtransfertooffice                    
,c.dsolvedatetime               
,c.vmanualjobno as vmanualjobnos         
,isnull(c.nfollowupno,0) as nfollowupno            
,c.dfollowupdt           
,isnull(mstrepair.bmajor,0) as ddlmajor        
,mstpartyprofile.ncode as npartyprofile    
,case when isnull(c.bBMreject,0)=1 and isnull(c.bhoreject,0)=0 then 'Yes' else 'No' end as bmreject    
,case when isnull(c.bhoreject,0)=1 and isnull(c.bhounreject,0)=0 then 'Yes' else 'No' end as horeject   
,case when isnull(c.bhoreject,0)=1 and isnull(c.bhounreject,0)=0 then 2 else case when isnull(c.bBMreject,0)=1 and isnull(c.bhoreject,0)=0 then 1 end end as rejectionstatus  
FROM   dbo.trhcalls c                                                                          
INNER JOIN  dbo.mstitems  ON c.nitem = dbo.mstitems.ncode                                                                           
INNER JOIN  dbo.mstfixedselection ON c.ncalltype = dbo.mstfixedselection.ncode                                                                           
INNER JOIN  dbo.mstprorg  ON c.nitemserialno = dbo.mstprorg.ncode                                                          
                                                                                       
--LEFT OUTER JOIN dbo.trdcalls3parts ON c.ncode = partsAgg.ncalls AND c.nofficeid = partsAgg.nofficeid                                                                          
--LEFT OUTER JOIN dbo.trdcalls2fault ON c.nofficeid = dbo.trdcalls2fault.nofficeid AND c.ncode = dbo.trdcalls2fault.ncalls                                                        
--LEFT OUTER JOIN visitAgg ON c.ncode = visitAgg.ncalls AND c.nofficeid = visitAgg.nofficeid  

LEFT JOIN (
    SELECT ncalls, nofficeid,
           MAX(dvisitdatetime) AS dvisitdatetime,
           MAX(ntimespent) AS ntimespent,
           MAX(nvisitby) AS nvisitby
    FROM trdcalls1visit
    GROUP BY ncalls, nofficeid
) visitAgg
    ON visitAgg.ncalls = c.ncode
    AND visitAgg.nofficeid = c.nofficeid


LEFT JOIN (
    SELECT ncalls, nofficeid,
           MAX(ndefect) AS ndefect,
           MAX(nrepair) AS nrepair
    FROM dbo.trdcalls2fault
    GROUP BY ncalls, nofficeid
) faultAgg
    ON faultAgg.ncalls = c.ncode
    AND faultAgg.nofficeid = c.nofficeid


LEFT JOIN (
    SELECT ncalls, nofficeid,
           MAX(nitem) AS nitem
    FROM dbo.trdcalls3parts
    GROUP BY ncalls, nofficeid
) partsAgg
    ON partsAgg.ncalls = c.ncode
    AND partsAgg.nofficeid = c.nofficeid

                                                                         
LEFT OUTER JOIN dbo.mstusers  ON c.nengineer = dbo.mstusers.ncode                                                        
LEFT OUTER JOIN dbo.mstroute                                                                           
INNER JOIN      dbo.mstparty ON dbo.mstroute.ncode = dbo.mstparty.nroute                                            
INNER JOIN      dbo.mstcity  ON dbo.mstroute.ncity = dbo.mstcity.ncode ON c.nparty = dbo.mstparty.ncode                                                
LEFT OUTER JOIN dbo.mstparty AS soldby ON c.nsoldby = soldby.ncode                                                                           
LEFT OUTER JOIN dbo.mstcheckset ON c.ncheckset = dbo.mstcheckset.ncode                                                                                       
LEFT OUTER JOIN dbo.mstitems spareitem ON partsAgg.nitem = spareitem.ncode                                                                           
LEFT OUTER JOIN dbo.mstcallpendingreasons ON c.npendingreason = dbo.mstcallpendingreasons.ncode                                                    
LEFT OUTER JOIN dbo.mstfixedselection fixedselection_priority ON c.npriority = fixedselection_priority.ncode     ----Added by Pranjali on 08-May-2018                                                                                    
LEFT OUTER JOIN mstpartyprofile on mstparty.npartyprofile=mstpartyprofile.ncode--Added by Pranjali on 14052019                        
left outer join mstoffice on mstoffice.ncode=c.nofficeid                        
left outer join mstoffice transferoffice on transferoffice.ncode=c.ntransfertooffice               
left outer join mstrepair on mstrepair.ncode=faultAgg.nrepair       
LEFT JOIN dbo.mstprorg pr ON pr.ncode = c.nitemserialno
--ORDER BY callsntrnno DESC