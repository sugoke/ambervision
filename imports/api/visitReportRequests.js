import { Meteor } from 'meteor/meteor';
import { Mongo } from 'meteor/mongo';

/**
 * Visit report requests — compliance asking a client's RM for a meeting /
 * visit report (compliance dashboard → "Request report").
 *
 * Schema:
 * {
 *   _id, entityId, clientNameSnapshot,
 *   rmIds: [userId],                 // notified RMs (entity assignedUserIds / RM)
 *   requestedBy, requestedByName, requestedAt, note,
 *   status: 'open' | 'fulfilled' | 'cancelled',
 *   meetingReportId, fulfilledAt, fulfilledBy,   // set when a report is finalized
 *   cancelledAt, cancelledBy
 * }
 *
 * A request is fulfilled by the next meeting report finalized for the client
 * (meetingReports.finalize), whoever writes it.
 */
export const VisitReportRequestsCollection = new Mongo.Collection('visitReportRequests');

export const VISIT_REQUEST_STATUS = {
  OPEN: 'open',
  FULFILLED: 'fulfilled',
  CANCELLED: 'cancelled'
};

if (Meteor.isServer) {
  Meteor.startup(() => {
    VisitReportRequestsCollection.createIndex({ entityId: 1, status: 1 });
    VisitReportRequestsCollection.createIndex({ rmIds: 1, status: 1 });
  });
}
