import { Mongo } from 'meteor/mongo';
import { Meteor } from 'meteor/meteor';
import { SessionHelpers } from '/imports/api/sessions';
import { UsersCollection } from '/imports/api/users';

export const TemplatesCollection = new Mongo.Collection('templates');

// Template definitions are now hardcoded below

// Template schema validation and helper methods
export const TemplateHelpers = {
  // Create a new template
  async create(templateData, userId) {
    const template = {
      ...templateData,
      createdBy: userId,
      createdAt: new Date(),
      updatedAt: new Date(),
      isBuiltIn: false, // User-created templates
      version: 1
    };

    try {
      const templateId = await TemplatesCollection.insertAsync(template);
      return templateId;
    } catch (error) {
      throw new Meteor.Error('template-create-failed', `Failed to create template: ${error.message}`);
    }
  },

  // Update an existing template
  async update(templateId, updates, userId) {
    const template = await TemplatesCollection.findOneAsync(templateId);
    
    if (!template) {
      throw new Meteor.Error('template-not-found', 'Template not found');
    }

    // Only allow updates by the creator or admins
    if (template.createdBy !== userId && !this.isAdmin(userId)) {
      throw new Meteor.Error('not-authorized', 'Not authorized to update this template');
    }

    try {
      await TemplatesCollection.updateAsync(templateId, {
        $set: {
          ...updates,
          updatedAt: new Date(),
          updatedBy: userId,
          version: (template.version || 1) + 1
        }
      });
      return true;
    } catch (error) {
      throw new Meteor.Error('template-update-failed', `Failed to update template: ${error.message}`);
    }
  },

  // Delete a template
  async delete(templateId, userId) {
    const template = await TemplatesCollection.findOneAsync(templateId);
    
    if (!template) {
      throw new Meteor.Error('template-not-found', 'Template not found');
    }

    // Only allow deletion by the creator or admins, and prevent deletion of built-in templates
    if (template.isBuiltIn && !this.isAdmin(userId)) {
      throw new Meteor.Error('not-authorized', 'Cannot delete built-in templates');
    }

    if (template.createdBy !== userId && !this.isAdmin(userId)) {
      throw new Meteor.Error('not-authorized', 'Not authorized to delete this template');
    }

    try {
      await TemplatesCollection.removeAsync(templateId);
      return true;
    } catch (error) {
      throw new Meteor.Error('template-delete-failed', `Failed to delete template: ${error.message}`);
    }
  },

  // Get all templates accessible to a user
  async getAccessibleTemplates(userId) {
    const query = {
      $or: [
        { isBuiltIn: true }, // Built-in templates available to all
        { createdBy: userId }, // User's own templates
        { isPublic: true } // Public templates shared by others
      ]
    };

    return TemplatesCollection.find(query, {
      sort: { 
        isBuiltIn: -1, // Built-in templates first
        updatedAt: -1  // Then by most recently updated
      }
    }).fetchAsync();
  },

  // Helper to check if user is admin
  isAdmin(userId) {
    if (!userId) return false;
    
    // Check if Meteor is available and users collection exists
    if (!Meteor || !Meteor.users) return false;
    
    const user = Meteor.users.findOne(userId);
    return user && (user.role === 'admin' || user.role === 'superadmin');
  },

  // Clone a template (create a copy)
  async clone(templateId, userId, newName) {
    const originalTemplate = await TemplatesCollection.findOneAsync(templateId);
    
    if (!originalTemplate) {
      throw new Meteor.Error('template-not-found', 'Template not found');
    }

    const clonedTemplate = {
      name: newName || `${originalTemplate.name} (Copy)`,
      description: `Copy of ${originalTemplate.description}`,
      droppedItems: originalTemplate.droppedItems,
      category: originalTemplate.category || 'user',
      isBuiltIn: false,
      isPublic: false,
      createdBy: userId,
      createdAt: new Date(),
      updatedAt: new Date(),
      version: 1,
      clonedFrom: templateId
    };

    return await this.create(clonedTemplate, userId);
  }
};

// Built-in templates available to all users - Hardcoded with nice icons
export const BUILT_IN_TEMPLATES = [
  {
    _id: "phoenix_autocallable",
    name: "Phoenix Autocallable",
    icon: "🔥",
    category: "autocallable",
    description: "Memory phoenix autocallable with quarterly observations and step-down barrier",
    isBuiltIn: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    droppedItems: [
      // Timing setup
      {
        id: "observation_1",
        type: "observation",
        column: "quarterly",
        row: 1,
        value: "Quarterly Observations",
        sortOrder: 1
      },
      // Autocall condition
      {
        id: "barrier_1", 
        type: "barrier",
        column: "life",
        row: 2,
        value: "100% Autocall Level",
        barrier_type: "autocall",
        barrier_level: 100,
        sortOrder: 2
      },
      {
        id: "action_1",
        type: "action", 
        column: "life",
        row: 2,
        value: "Autocall: 100% + Memory Coupon",
        sortOrder: 3
      },
      // Protection at maturity
      {
        id: "barrier_2",
        type: "barrier",
        column: "maturity", 
        row: 3,
        value: "70% Protection Barrier",
        barrier_type: "protection",
        barrier_level: 70,
        sortOrder: 4
      },
      {
        id: "action_2",
        type: "action",
        column: "maturity",
        row: 3, 
        value: "100% + Memory Coupon if above 70%",
        sortOrder: 5
      }
    ]
  },
  {
    _id: "orion_memory",
    name: "Orion",
    icon: "⭐",
    category: "memory",
    description: "Memory coupon structure with quarterly observations and protection",
    isBuiltIn: true,
    createdAt: new Date(), 
    updatedAt: new Date(),
    droppedItems: [
      // Timing
      {
        id: "observation_1",
        type: "observation",
        column: "quarterly",
        row: 1,
        value: "Quarterly Observations",
        sortOrder: 1
      },
      // Memory coupon logic
      {
        id: "barrier_1",
        type: "barrier", 
        column: "life",
        row: 2,
        value: "65% Coupon Barrier",
        barrier_type: "coupon",
        barrier_level: 65,
        sortOrder: 2
      },
      {
        id: "action_1",
        type: "action",
        column: "life", 
        row: 2,
        value: "Memory Coupon: 2.5%",
        sortOrder: 3
      },
      // Maturity protection
      {
        id: "barrier_2",
        type: "barrier",
        column: "maturity",
        row: 3,
        value: "65% Protection Barrier", 
        barrier_type: "protection",
        barrier_level: 65,
        sortOrder: 4
      },
      {
        id: "action_2", 
        type: "action",
        column: "maturity",
        row: 3,
        value: "100% + All Memory Coupons",
        sortOrder: 5
      }
    ]
  },
  {
    _id: "himalaya",
    name: "Himalaya",
    icon: "🏔️",
    category: "exotic",
    description: "Best performer selection at each observation - average all selections at maturity with floor protection",
    isBuiltIn: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    droppedItems: [
      // Custom observation schedule (number of observations = number of underlyings)
      {
        id: "observation_1",
        type: "observation",
        column: "custom",
        row: 1,
        value: "Custom Observation Schedule",
        sortOrder: 1
      },
      // Himalaya logic description
      {
        id: "action_1",
        type: "action",
        column: "life",
        row: 2,
        value: "Record best performer, remove from basket",
        sortOrder: 2
      },
      // Maturity calculation
      {
        id: "action_2",
        type: "action",
        column: "maturity",
        row: 3,
        value: "Average recorded performances with 100% floor",
        sortOrder: 3
      }
    ]
  },
  {
    _id: "shark_note",
    name: "Shark Note",
    icon: "🦈",
    category: "leveraged",
    description: "Leveraged participation note with knock-out barrier and enhanced returns",
    isBuiltIn: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    droppedItems: [
      // Daily observation
      {
        id: "observation_1",
        type: "observation",
        column: "daily",
        row: 1,
        value: "Daily Barrier Observation",
        sortOrder: 1
      },
      // Knock-out barrier
      {
        id: "barrier_1",
        type: "barrier",
        column: "life",
        row: 2,
        value: "140% Knock-Out Barrier",
        barrier_type: "knockout",
        barrier_level: 140,
        sortOrder: 2
      },
      {
        id: "action_1",
        type: "action",
        column: "life",
        row: 2,
        value: "Early Termination: 100% + Accrued",
        sortOrder: 3
      },
      // Leveraged participation
      {
        id: "action_2",
        type: "action",
        column: "maturity",
        row: 3,
        value: "100% + 200% Participation",
        sortOrder: 4
      }
    ]
  },
  {
    _id: "participation_note",
    name: "Participation Note",
    icon: "📈",
    category: "leveraged",
    description: "At maturity, investor receives performance of underlying(s) multiplied by participation rate. Supports single stock or basket configurations. Optional issuer call feature.",
    isBuiltIn: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    droppedItems: []
  },
  {
    _id: "reverse_convertible",
    name: "Reverse Convertible",
    icon: "🔄",
    category: "yield_enhancement",
    description: "Guaranteed coupon at maturity with capital protection barrier. Above barrier: full capital return. Below barrier: geared downside exposure (1/barrier ratio).",
    isBuiltIn: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    droppedItems: []
  },
  {
    _id: "reverse_convertible_bond",
    name: "Reverse Convertible (Bond)",
    icon: "📜",
    category: "yield_enhancement",
    description: "Guaranteed coupon at maturity with capital protection barrier on bond underlyings. Above barrier: full capital return. Below barrier: geared downside exposure (1/barrier ratio).",
    isBuiltIn: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    droppedItems: []
  }
];

// Server-side methods
if (Meteor.isServer) {
  const validateSessionAndGetUser = async (sessionId) => {
    if (!sessionId) {
      throw new Meteor.Error('not-authorized', 'Session ID required');
    }
    
    const session = await SessionHelpers.validateSession(sessionId);
    if (!session) {
      throw new Meteor.Error('not-authorized', 'Invalid or expired session');
    }
    
    const user = await UsersCollection.findOneAsync(session.userId);
    if (!user) {
      throw new Meteor.Error('not-authorized', 'User not found');
    }
    
    return user;
  };

  Meteor.methods({
    // Create template
    async 'templates.create'(templateData, sessionId) {
      const user = await validateSessionAndGetUser(sessionId);
      if (!user) {
        throw new Meteor.Error('not-authorized', 'You must be logged in to create templates');
      }

      // Validate required fields
      if (!templateData.name || !templateData.name.trim()) {
        throw new Meteor.Error('invalid-data', 'Template name is required');
      }
      
      if (!templateData.droppedItems || !Array.isArray(templateData.droppedItems)) {
        throw new Meteor.Error('invalid-data', 'Template must have valid payoff structure');
      }

      return await TemplateHelpers.create(templateData, user._id);
    },

    // Update template
    async 'templates.update'(templateId, updates, sessionId) {
      const user = await validateSessionAndGetUser(sessionId);
      if (!user) {
        throw new Meteor.Error('not-authorized', 'You must be logged in to update templates');
      }

      return await TemplateHelpers.update(templateId, updates, user._id);
    },

    // Delete template
    async 'templates.delete'(templateId, sessionId) {
      const user = await validateSessionAndGetUser(sessionId);
      if (!user) {
        throw new Meteor.Error('not-authorized', 'You must be logged in to delete templates');
      }

      return await TemplateHelpers.delete(templateId, user._id);
    },

    // Get user's accessible templates
    async 'templates.getAccessible'(sessionId) {
      const user = await validateSessionAndGetUser(sessionId);
      if (!user) {
        throw new Meteor.Error('not-authorized', 'You must be logged in to view templates');
      }

      return await TemplateHelpers.getAccessibleTemplates(user._id);
    },

    // Clone template
    async 'templates.clone'(templateId, newName, sessionId) {
      const user = await validateSessionAndGetUser(sessionId);
      if (!user) {
        throw new Meteor.Error('not-authorized', 'You must be logged in to clone templates');
      }

      return await TemplateHelpers.clone(templateId, user._id, newName);
    },

    // Debug method to check templates in database
    'templates.debug'() {
      try {
        console.log('=== TEMPLATES DEBUG METHOD CALLED ===');
        const count = TemplatesCollection.find({}).count();
        const templates = TemplatesCollection.find({}).fetch();
        
        console.log('templates.debug: Found', count, 'templates');
        console.log('templates.debug: Template details:', templates.map(t => ({
          id: t._id,
          name: t.name,
          isBuiltIn: t.isBuiltIn,
          category: t.category,
          hasDroppedItems: !!t.droppedItems,
          droppedItemsCount: t.droppedItems?.length || 0
        })));
        
        return {
          count,
          templates: templates.map(t => ({
            id: t._id,
            name: t.name,
            isBuiltIn: t.isBuiltIn,
            category: t.category,
            droppedItemsCount: t.droppedItems?.length || 0
          }))
        };
      } catch (error) {
        console.error('templates.debug: ERROR:', error);
        throw new Meteor.Error('debug-failed', `Debug failed: ${error.message}`);
      }
    },

    // Templates are now hardcoded in BUILT_IN_TEMPLATES array above
    // No database insertion needed
  });

  // Simple templates publication without parameters
  Meteor.publish('templates', function() {
    // Debug logging disabled to reduce console noise
    // console.log('=== SIMPLE TEMPLATES PUBLICATION CALLED ===');
    // console.log('Templates publication: this.userId =', this.userId);
    // console.log('Templates publication: connection ID =', this.connection?.id);
    
    try {
      // Return all templates - simple approach
      const cursor = TemplatesCollection.find({}, {
        sort: { 
          isBuiltIn: -1,
          updatedAt: -1 
        }
      });
      
      // console.log('Templates publication: Returning cursor (sync method)');
      // console.log('=== END SIMPLE TEMPLATES PUBLICATION ===');
      
      return cursor;
      
    } catch (error) {
      console.error('Templates publication: ERROR:', error);
      // console.log('=== TEMPLATES PUBLICATION ERROR END ===');
      return this.ready();
    }
  });
}